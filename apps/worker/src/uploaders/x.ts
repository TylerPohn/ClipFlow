import type { Job } from 'bullmq';
import type { VideoJob } from '@clipflow/shared';
import { prisma } from '@clipflow/db';
import * as crypto from 'crypto';

const CHUNK_SIZE = 5 * 1024 * 1024; // 5MB
const MEDIA_UPLOAD_URL = 'https://upload.twitter.com/1.1/media/upload.json';

interface MediaUploadInitResponse {
  media_id_string: string;
}

interface MediaUploadStatusResponse {
  processing_info?: {
    state: 'pending' | 'in_progress' | 'succeeded' | 'failed';
    check_after_secs?: number;
    error?: { message: string };
  };
}

/**
 * Refresh X access token if expired. Worker-side version.
 */
async function getValidAccessToken(platformAccountId: string): Promise<string> {
  const account = await prisma.platformAccount.findUnique({
    where: { id: platformAccountId },
  });

  if (!account?.accessToken) {
    throw new Error('No X PlatformAccount found or missing access token');
  }

  const fiveMinutesFromNow = new Date(Date.now() + 5 * 60 * 1000);

  if (
    account.tokenExpiresAt &&
    account.tokenExpiresAt < fiveMinutesFromNow &&
    account.refreshToken
  ) {
    const credentials = Buffer.from(
      `${process.env.X_CLIENT_ID}:${process.env.X_CLIENT_SECRET}`
    ).toString('base64');

    const res = await fetch('https://api.x.com/2/oauth2/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${credentials}`,
      },
      body: new URLSearchParams({
        refresh_token: account.refreshToken,
        grant_type: 'refresh_token',
      }),
    });

    if (!res.ok) {
      throw new Error(`X token refresh failed: ${res.status}`);
    }

    const data = await res.json();

    await prisma.platformAccount.update({
      where: { id: platformAccountId },
      data: {
        accessToken: data.access_token,
        tokenExpiresAt: new Date(Date.now() + data.expires_in * 1000),
        ...(data.refresh_token ? { refreshToken: data.refresh_token } : {}),
      },
    });

    return data.access_token;
  }

  return account.accessToken;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// --- OAuth 1.0a signing ---

function percentEncode(str: string): string {
  return encodeURIComponent(str).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

function generateOAuthNonce(): string {
  return crypto.randomBytes(16).toString('hex');
}

function buildOAuth1Header(
  method: string,
  url: string,
  params: Record<string, string>,
  consumerKey: string,
  consumerSecret: string,
  tokenKey: string,
  tokenSecret: string
): string {
  const oauthParams: Record<string, string> = {
    oauth_consumer_key: consumerKey,
    oauth_nonce: generateOAuthNonce(),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: String(Math.floor(Date.now() / 1000)),
    oauth_token: tokenKey,
    oauth_version: '1.0',
  };

  // Combine oauth params + request params for signature base
  const allParams = { ...oauthParams, ...params };
  const sortedKeys = Object.keys(allParams).sort();
  const paramString = sortedKeys
    .map((k) => `${percentEncode(k)}=${percentEncode(allParams[k])}`)
    .join('&');

  const signatureBase = `${method.toUpperCase()}&${percentEncode(url)}&${percentEncode(paramString)}`;
  const signingKey = `${percentEncode(consumerSecret)}&${percentEncode(tokenSecret)}`;
  const signature = crypto.createHmac('sha1', signingKey).update(signatureBase).digest('base64');

  oauthParams['oauth_signature'] = signature;

  const headerParts = Object.keys(oauthParams)
    .sort()
    .map((k) => `${percentEncode(k)}="${percentEncode(oauthParams[k])}"`)
    .join(', ');

  return `OAuth ${headerParts}`;
}

/**
 * Upload a video to X (Twitter) and create a tweet.
 *
 * Uses v1.1 chunked media upload with OAuth 1.0a signing,
 * then v2 tweet creation with OAuth 2.0 Bearer token.
 */
export async function uploadToX(
  platformAccountId: string,
  videoBuffer: Buffer,
  caption: string,
  job: Job<VideoJob>
): Promise<string> {
  const accessToken = await getValidAccessToken(platformAccountId);

  const consumerKey = process.env.X_CONSUMER_KEY;
  const consumerSecret = process.env.X_CONSUMER_SECRET;

  if (!consumerKey || !consumerSecret) {
    throw new Error('X_CONSUMER_KEY and X_CONSUMER_SECRET are required for media upload');
  }

  // For OAuth 1.0a media upload, we need the user's OAuth 1.0a tokens.
  // The X API allows using the OAuth 2.0 user access token as the OAuth 1.0a token
  // when the app has both OAuth 1.0a and 2.0 configured.
  // The token secret is empty string when using OAuth 2.0 access tokens with 1.0a signing.
  const userToken = accessToken;
  const userTokenSecret = '';

  // Step 1: INIT
  const initParams = {
    command: 'INIT',
    media_type: 'video/mp4',
    total_bytes: String(videoBuffer.byteLength),
    media_category: 'tweet_video',
  };

  const initAuth = buildOAuth1Header(
    'POST', MEDIA_UPLOAD_URL, initParams,
    consumerKey, consumerSecret, userToken, userTokenSecret
  );

  const initRes = await fetch(MEDIA_UPLOAD_URL, {
    method: 'POST',
    headers: {
      Authorization: initAuth,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(initParams),
  });

  if (!initRes.ok) {
    const body = await initRes.text();
    throw new Error(`X media INIT failed (${initRes.status}): ${body}`);
  }

  const initData: MediaUploadInitResponse = await initRes.json();
  const mediaId = initData.media_id_string;
  console.log(`X media INIT complete, media_id: ${mediaId}`);

  await job.updateProgress(50);

  // Step 2: APPEND chunks
  // For multipart APPEND, OAuth 1.0a signature only includes command, media_id, segment_index
  // (not the binary media_data)
  const totalChunks = Math.ceil(videoBuffer.byteLength / CHUNK_SIZE);

  for (let i = 0; i < totalChunks; i++) {
    const start = i * CHUNK_SIZE;
    const end = Math.min(start + CHUNK_SIZE, videoBuffer.byteLength);
    const chunk = videoBuffer.subarray(start, end);

    const appendParams = {
      command: 'APPEND',
      media_id: mediaId,
      segment_index: String(i),
    };

    const appendAuth = buildOAuth1Header(
      'POST', MEDIA_UPLOAD_URL, appendParams,
      consumerKey, consumerSecret, userToken, userTokenSecret
    );

    // Use multipart/form-data for the actual request body
    const form = new FormData();
    form.append('command', 'APPEND');
    form.append('media_id', mediaId);
    form.append('segment_index', String(i));
    form.append('media_data', Buffer.from(chunk).toString('base64'));

    const appendRes = await fetch(MEDIA_UPLOAD_URL, {
      method: 'POST',
      headers: {
        Authorization: appendAuth,
      },
      body: form,
    });

    if (!appendRes.ok) {
      const body = await appendRes.text();
      throw new Error(`X media APPEND chunk ${i} failed (${appendRes.status}): ${body}`);
    }
  }

  console.log(`X media APPEND complete (${totalChunks} chunks)`);
  await job.updateProgress(70);

  // Step 3: FINALIZE
  const finalizeParams = {
    command: 'FINALIZE',
    media_id: mediaId,
  };

  const finalizeAuth = buildOAuth1Header(
    'POST', MEDIA_UPLOAD_URL, finalizeParams,
    consumerKey, consumerSecret, userToken, userTokenSecret
  );

  const finalizeRes = await fetch(MEDIA_UPLOAD_URL, {
    method: 'POST',
    headers: {
      Authorization: finalizeAuth,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(finalizeParams),
  });

  if (!finalizeRes.ok) {
    const body = await finalizeRes.text();
    throw new Error(`X media FINALIZE failed (${finalizeRes.status}): ${body}`);
  }

  console.log('X media FINALIZE complete');
  await job.updateProgress(80);

  // Step 4: Poll STATUS until processing complete
  let processingComplete = false;
  while (!processingComplete) {
    const statusParams = {
      command: 'STATUS',
      media_id: mediaId,
    };

    const statusAuth = buildOAuth1Header(
      'GET', MEDIA_UPLOAD_URL, statusParams,
      consumerKey, consumerSecret, userToken, userTokenSecret
    );

    const statusRes = await fetch(
      `${MEDIA_UPLOAD_URL}?command=STATUS&media_id=${mediaId}`,
      { headers: { Authorization: statusAuth } }
    );

    if (!statusRes.ok) {
      const body = await statusRes.text();
      throw new Error(`X media STATUS failed (${statusRes.status}): ${body}`);
    }

    const statusData: MediaUploadStatusResponse = await statusRes.json();

    if (!statusData.processing_info) {
      processingComplete = true;
    } else if (statusData.processing_info.state === 'succeeded') {
      processingComplete = true;
    } else if (statusData.processing_info.state === 'failed') {
      throw new Error(
        `X media processing failed: ${statusData.processing_info.error?.message ?? 'unknown error'}`
      );
    } else {
      const waitSecs = statusData.processing_info.check_after_secs ?? 5;
      console.log(`X media processing ${statusData.processing_info.state}, waiting ${waitSecs}s...`);
      await sleep(waitSecs * 1000);
    }
  }

  console.log('X media processing succeeded');
  await job.updateProgress(90);

  // Step 5: Create tweet with media (v2 API, OAuth 2.0)
  const tweetRes = await fetch('https://api.x.com/2/tweets', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      text: caption,
      media: {
        media_ids: [mediaId],
      },
    }),
  });

  if (!tweetRes.ok) {
    const body = await tweetRes.text();
    throw new Error(`X tweet creation failed (${tweetRes.status}): ${body}`);
  }

  const tweetData = await tweetRes.json();
  const tweetId = tweetData.data?.id as string;
  console.log(`X tweet created: ${tweetId}`);

  return tweetId;
}

import type { Job } from 'bullmq';
import type { VideoJob } from '@clipflow/shared';
import { prisma } from '@clipflow/db';

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

/**
 * Upload a video to X (Twitter) and create a tweet.
 *
 * Uses v1.1 chunked media upload with OAuth 2.0 user access token,
 * then v2 tweet creation.
 *
 * The v1.1 media upload endpoint supports OAuth 2.0 user context
 * when the token has the media.write scope.
 */
export async function uploadToX(
  platformAccountId: string,
  videoBuffer: Buffer,
  caption: string,
  job: Job<VideoJob>
): Promise<string> {
  const accessToken = await getValidAccessToken(platformAccountId);
  const authHeader = `Bearer ${accessToken}`;

  // Step 1: INIT
  const initRes = await fetch(MEDIA_UPLOAD_URL, {
    method: 'POST',
    headers: {
      Authorization: authHeader,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      command: 'INIT',
      media_type: 'video/mp4',
      total_bytes: String(videoBuffer.byteLength),
      media_category: 'tweet_video',
    }),
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
  const totalChunks = Math.ceil(videoBuffer.byteLength / CHUNK_SIZE);

  for (let i = 0; i < totalChunks; i++) {
    const start = i * CHUNK_SIZE;
    const end = Math.min(start + CHUNK_SIZE, videoBuffer.byteLength);
    const chunk = videoBuffer.subarray(start, end);

    const form = new FormData();
    form.append('command', 'APPEND');
    form.append('media_id', mediaId);
    form.append('segment_index', String(i));
    form.append('media', new Blob([chunk], { type: 'application/octet-stream' }), 'chunk.mp4');

    const appendRes = await fetch(MEDIA_UPLOAD_URL, {
      method: 'POST',
      headers: { Authorization: authHeader },
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
  const finalizeRes = await fetch(MEDIA_UPLOAD_URL, {
    method: 'POST',
    headers: {
      Authorization: authHeader,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      command: 'FINALIZE',
      media_id: mediaId,
    }),
  });

  if (!finalizeRes.ok) {
    const body = await finalizeRes.text();
    throw new Error(`X media FINALIZE failed (${finalizeRes.status}): ${body}`);
  }

  const finalizeData = await finalizeRes.json();
  console.log('X media FINALIZE complete');
  await job.updateProgress(80);

  // Step 4: Poll STATUS until processing complete
  if (finalizeData.processing_info) {
    let processingComplete = false;
    while (!processingComplete) {
      const statusRes = await fetch(
        `${MEDIA_UPLOAD_URL}?command=STATUS&media_id=${mediaId}`,
        { headers: { Authorization: authHeader } }
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
  }

  console.log('X media processing succeeded');
  await job.updateProgress(90);

  // Step 5: Create tweet with media
  const tweetRes = await fetch('https://api.x.com/2/tweets', {
    method: 'POST',
    headers: {
      Authorization: authHeader,
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

import type { Job } from 'bullmq';
import type { FileHandle } from 'fs/promises';
import { open, stat } from 'fs/promises';
import type { VideoJob } from '@clipflow/shared';
import { prisma } from '@clipflow/db';

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const RESUMABLE_UPLOAD_URL =
  'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status';

// Every chunk except the last one must be a multiple of 256KB (Google's rule).
const CHUNK_SIZE = 8 * 1024 * 1024; // 8MB
// The video is only created once the bytes finish, so retrying inside an open
// session never costs a second 1600-unit insert. Opening the session is retried
// too, but only on transient errors and only a couple of times.
const MAX_INIT_ATTEMPTS = 3;
const MAX_CHUNK_ATTEMPTS = 5;

const TITLE_MAX_LENGTH = 100;
const DESCRIPTION_MAX_LENGTH = 5000;
const TAGS_MAX_TOTAL_LENGTH = 500;

// 22 = People & Blogs, the safest default for arbitrary creator content.
const DEFAULT_CATEGORY_ID = '22';

export type YouTubePrivacyStatus = 'private' | 'unlisted' | 'public';

export interface YouTubeUploadOptions {
  title: string;
  description: string;
  privacyStatus: YouTubePrivacyStatus;
  tags?: string[];
  madeForKids: boolean;
}

interface GoogleTokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
}

interface VideoResource {
  id: string;
}

interface GoogleApiErrorBody {
  error?: {
    code?: number;
    message?: string;
    errors?: { reason?: string; message?: string }[];
  };
}

/** How much of the resumable session the server says it already holds. */
type ResumeState =
  | { kind: 'incomplete'; offset: number }
  | { kind: 'complete'; videoId: string };

/**
 * Refresh the Google access token if expired. Worker-side version of
 * apps/web/src/lib/youtube.ts#getValidAccessToken.
 */
async function getValidAccessToken(platformAccountId: string): Promise<string> {
  const account = await prisma.platformAccount.findUnique({
    where: { id: platformAccountId },
  });

  if (!account?.accessToken) {
    throw new Error('No YouTube PlatformAccount found or missing access token');
  }

  const fiveMinutesFromNow = new Date(Date.now() + 5 * 60 * 1000);

  if (
    account.tokenExpiresAt &&
    account.tokenExpiresAt < fiveMinutesFromNow &&
    account.refreshToken
  ) {
    const res = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID!,
        client_secret: process.env.GOOGLE_CLIENT_SECRET!,
        refresh_token: account.refreshToken,
        grant_type: 'refresh_token',
      }),
    });

    if (!res.ok) {
      const errorBody = await res.text();
      console.error(`YouTube token refresh failed: ${res.status}`, errorBody);
      throw new Error(
        `YouTube token refresh failed: ${res.status} - ${errorBody}`,
      );
    }

    const data = (await res.json()) as GoogleTokenResponse;

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

function backoffMs(attempt: number): number {
  return Math.min(2 ** attempt * 1000, 30_000);
}

/**
 * 5xx, 429 and 408 are transient; anything else in the 4xx range (bad title,
 * quota exhausted, revoked scope) will fail identically on every retry, so we
 * give up immediately rather than burning another 1600-unit insert.
 */
function isRetryableStatus(status: number): boolean {
  return status >= 500 || status === 429 || status === 408;
}

/**
 * Turn a Google API error body into a message worth putting in the job log.
 */
function describeYouTubeError(
  context: string,
  status: number,
  body: string,
): string {
  let reason: string | undefined;
  let message: string | undefined;

  try {
    const parsed = JSON.parse(body) as GoogleApiErrorBody;
    reason = parsed.error?.errors?.[0]?.reason;
    message = parsed.error?.message;
  } catch {
    // 5xx responses are often HTML rather than JSON — fall back to the raw body.
  }

  if (reason === 'quotaExceeded' || reason === 'dailyLimitExceeded') {
    return `YouTube ${context} failed: daily API quota exhausted (videos.insert costs 1600 of the default 10,000 units/day). Quota resets at midnight Pacific Time — retrying before then will fail the same way.`;
  }

  const detail = message ?? body;
  return reason
    ? `YouTube ${context} failed (${status} ${reason}): ${detail}`
    : `YouTube ${context} failed (${status}): ${detail}`;
}

/**
 * Titles are capped at 100 characters and reject angle brackets. An empty
 * title is rejected too, so fall back to something the API will accept.
 */
function sanitizeTitle(raw: string): string {
  const cleaned = raw
    .replace(/[<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, TITLE_MAX_LENGTH)
    .trim();

  return cleaned || 'Untitled';
}

/**
 * Descriptions are capped at 5000 characters and reject angle brackets too.
 */
function sanitizeDescription(raw: string): string {
  return raw.replace(/[<>]/g, '').slice(0, DESCRIPTION_MAX_LENGTH);
}

/**
 * YouTube budgets tags by total character count (500), not by tag count, so
 * take tags until the budget runs out instead of letting the API reject them.
 */
function sanitizeTags(tags: string[]): string[] {
  const kept: string[] = [];
  let used = 0;

  for (const tag of tags) {
    const cleaned = tag.replace(/[<>]/g, '').trim();
    if (!cleaned) continue;
    // Tags are comma-joined by the API, so each one after the first costs +1.
    const cost = cleaned.length + (kept.length > 0 ? 1 : 0);
    if (used + cost > TAGS_MAX_TOTAL_LENGTH) break;
    kept.push(cleaned);
    used += cost;
  }

  return kept;
}

/**
 * `Range: bytes=0-262143` means the server holds bytes 0..262143, so the next
 * byte we owe it is 262144. A missing header means it holds nothing yet.
 */
function parseResumeOffset(rangeHeader: string | null): number {
  const match = rangeHeader?.match(/bytes=0-(\d+)/);
  return match ? parseInt(match[1], 10) + 1 : 0;
}

/**
 * Ask the session how many bytes it actually holds. Used after a transient
 * failure so we resume from the server's view instead of guessing.
 */
async function queryResumeState(
  sessionUrl: string,
  authHeader: string,
  fileSize: number,
): Promise<ResumeState> {
  const res = await fetch(sessionUrl, {
    method: 'PUT',
    headers: {
      Authorization: authHeader,
      'Content-Range': `bytes */${fileSize}`,
    },
  });

  if (res.status === 308) {
    return {
      kind: 'incomplete',
      offset: parseResumeOffset(res.headers.get('range')),
    };
  }

  const body = await res.text();

  if (res.ok) {
    // The final chunk did land before the connection broke.
    const video = JSON.parse(body) as VideoResource;
    return { kind: 'complete', videoId: video.id };
  }

  throw new Error(describeYouTubeError('resume query', res.status, body));
}

async function readChunk(
  handle: FileHandle,
  start: number,
  length: number,
): Promise<Uint8Array> {
  const buffer = Buffer.alloc(length);
  const { bytesRead } = await handle.read(buffer, 0, length, start);
  return new Uint8Array(
    bytesRead === length ? buffer : buffer.subarray(0, bytesRead),
  );
}

/**
 * Open a resumable session. The video isn't created until the bytes finish
 * uploading, so this is the only step we ever retry as a whole.
 */
async function initResumableSession(
  authHeader: string,
  fileSize: number,
  options: YouTubeUploadOptions,
): Promise<string> {
  const body = JSON.stringify({
    snippet: {
      title: sanitizeTitle(options.title),
      description: sanitizeDescription(options.description),
      tags: sanitizeTags(options.tags ?? []),
      categoryId: DEFAULT_CATEGORY_ID,
    },
    status: {
      privacyStatus: options.privacyStatus,
      selfDeclaredMadeForKids: options.madeForKids,
    },
  });

  for (let attempt = 1; attempt <= MAX_INIT_ATTEMPTS; attempt++) {
    const res = await fetch(RESUMABLE_UPLOAD_URL, {
      method: 'POST',
      headers: {
        Authorization: authHeader,
        'Content-Type': 'application/json; charset=UTF-8',
        'X-Upload-Content-Length': String(fileSize),
        'X-Upload-Content-Type': 'video/mp4',
      },
      body,
    });

    if (res.ok) {
      const sessionUrl = res.headers.get('location');
      if (!sessionUrl) {
        throw new Error(
          'YouTube resumable init succeeded but returned no Location header',
        );
      }
      return sessionUrl;
    }

    const errorBody = await res.text();

    if (!isRetryableStatus(res.status) || attempt === MAX_INIT_ATTEMPTS) {
      throw new Error(
        describeYouTubeError('resumable init', res.status, errorBody),
      );
    }

    console.error(
      `YouTube resumable init attempt ${attempt} failed (${res.status}), retrying:`,
      errorBody,
    );
    await sleep(backoffMs(attempt));
  }

  // Unreachable: the loop either returns or throws on its last attempt.
  throw new Error('YouTube resumable init exhausted all attempts');
}

/**
 * Push the file into an open session, honouring 308 Resume Incomplete and
 * resuming from the server's Range after a transient failure.
 */
async function uploadSessionBytes(
  sessionUrl: string,
  authHeader: string,
  handle: FileHandle,
  fileSize: number,
  job: Job<VideoJob>,
): Promise<string> {
  let offset = 0;
  let attempt = 0;
  let lastReportedProgress = 40;

  // The transfer spans 40 -> 85; the caller owns everything outside that.
  const reportProgress = async (): Promise<void> => {
    const progress = 40 + Math.round((offset / fileSize) * 45);
    if (progress > lastReportedProgress) {
      lastReportedProgress = progress;
      await job.updateProgress(progress);
    }
  };

  while (offset < fileSize) {
    const end = Math.min(offset + CHUNK_SIZE, fileSize);
    const chunk = await readChunk(handle, offset, end - offset);

    let res: Response;
    try {
      res = await fetch(sessionUrl, {
        method: 'PUT',
        headers: {
          Authorization: authHeader,
          'Content-Type': 'video/mp4',
          'Content-Range': `bytes ${offset}-${end - 1}/${fileSize}`,
        },
        body: chunk,
      });
    } catch (networkError) {
      attempt += 1;
      if (attempt >= MAX_CHUNK_ATTEMPTS) {
        throw new Error(
          `YouTube chunk upload at byte ${offset} failed after ${attempt} attempts: ${
            networkError instanceof Error ? networkError.message : networkError
          }`,
        );
      }
      console.error(
        `YouTube chunk upload at byte ${offset} errored, attempt ${attempt}:`,
        networkError instanceof Error ? networkError.message : networkError,
      );
      await sleep(backoffMs(attempt));
      const state = await queryResumeState(sessionUrl, authHeader, fileSize);
      if (state.kind === 'complete') return state.videoId;
      offset = state.offset;
      continue;
    }

    if (res.status === 308) {
      const resumeOffset = parseResumeOffset(res.headers.get('range'));
      if (resumeOffset <= offset) {
        // The server kept nothing from that chunk — count it as a failure so a
        // wedged session can't spin here forever.
        attempt += 1;
        if (attempt >= MAX_CHUNK_ATTEMPTS) {
          throw new Error(
            `YouTube upload stalled at byte ${offset} of ${fileSize} after ${attempt} attempts`,
          );
        }
        await sleep(backoffMs(attempt));
        continue;
      }
      offset = resumeOffset;
      attempt = 0;
      await reportProgress();
      continue;
    }

    if (res.ok) {
      const video = (await res.json()) as VideoResource;
      return video.id;
    }

    const errorBody = await res.text();

    if (!isRetryableStatus(res.status)) {
      throw new Error(
        describeYouTubeError('chunk upload', res.status, errorBody),
      );
    }

    attempt += 1;
    if (attempt >= MAX_CHUNK_ATTEMPTS) {
      throw new Error(
        describeYouTubeError('chunk upload', res.status, errorBody),
      );
    }

    console.error(
      `YouTube chunk upload at byte ${offset} failed (${res.status}), attempt ${attempt}:`,
      errorBody,
    );
    await sleep(backoffMs(attempt));
    const state = await queryResumeState(sessionUrl, authHeader, fileSize);
    if (state.kind === 'complete') return state.videoId;
    offset = state.offset;
  }

  // Every byte was acknowledged by a 308 but we never saw the final resource.
  const state = await queryResumeState(sessionUrl, authHeader, fileSize);
  if (state.kind === 'complete') return state.videoId;
  throw new Error(
    `YouTube upload sent all ${fileSize} bytes but the session never returned a video ID`,
  );
}

/**
 * Upload a video to YouTube via the Data API v3 resumable protocol.
 *
 * Metadata is sent once when the session is opened, then the file is streamed
 * in 8MB chunks. Only the byte transfer is retried — videos.insert costs 1600
 * quota units, so a rejected insert (bad metadata, exhausted quota, missing
 * youtube.upload scope) fails fast instead of being re-attempted.
 *
 * Returns the created video ID.
 */
export async function uploadToYouTube(
  platformAccountId: string,
  videoPath: string,
  options: YouTubeUploadOptions,
  job: Job<VideoJob>,
): Promise<string> {
  const accessToken = await getValidAccessToken(platformAccountId);
  const authHeader = `Bearer ${accessToken}`;

  const { size: fileSize } = await stat(videoPath);
  if (fileSize === 0) {
    throw new Error(`YouTube upload aborted: ${videoPath} is empty`);
  }

  // Step 1: Open the resumable session (metadata only, no bytes yet)
  const sessionUrl = await initResumableSession(authHeader, fileSize, options);
  console.log(
    `YouTube resumable session opened for ${fileSize} bytes (privacy: ${options.privacyStatus})`,
  );

  await job.updateProgress(40);

  // Step 2: Transfer the file
  const handle = await open(videoPath, 'r');
  let videoId: string;
  try {
    videoId = await uploadSessionBytes(
      sessionUrl,
      authHeader,
      handle,
      fileSize,
      job,
    );
  } finally {
    await handle.close();
  }

  console.log(`YouTube video created: ${videoId}`);
  await job.updateProgress(85);

  return videoId;
}

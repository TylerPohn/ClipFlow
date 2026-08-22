import type { Job } from 'bullmq';
import type { VideoJob } from '@clipflow/shared';
import { prisma } from '@clipflow/db';
import {
  ensureFreshInstagramToken,
  INSTAGRAM_GRAPH_API_BASE,
} from '../lib/instagram-token';

const MAX_CAPTION_LENGTH = 2_200;
const STATUS_POLL_INTERVAL_MS = 60_000;
const MAX_STATUS_CHECKS = 5;

interface InstagramApiResponse {
  id?: string;
  permalink?: string;
  error?: { message?: string };
}

export interface InstagramPublishResult {
  id: string;
  permalink: string | null;
}

interface InstagramContainerStatus {
  status_code?: 'EXPIRED' | 'ERROR' | 'FINISHED' | 'IN_PROGRESS' | 'PUBLISHED';
  status?: string;
  error?: { message?: string };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readInstagramResponse<T>(
  response: Response,
  operation: string,
): Promise<T> {
  const data = (await response.json().catch(() => ({}))) as T &
    InstagramApiResponse;
  if (!response.ok) {
    throw new Error(
      `${operation} failed (${response.status}): ${data.error?.message ?? 'unknown error'}`,
    );
  }
  return data;
}

export async function uploadToInstagram(
  platformAccountId: string,
  videoUrl: string,
  caption: string,
  job: Job<VideoJob>,
): Promise<InstagramPublishResult> {
  const account = await prisma.platformAccount.findUnique({
    where: { id: platformAccountId },
  });
  if (!account?.platformUserId) {
    throw new Error('No Instagram PlatformAccount found');
  }

  const accessToken = await ensureFreshInstagramToken(platformAccountId);
  const truncatedCaption = caption.slice(0, MAX_CAPTION_LENGTH);

  const createResponse = await fetch(
    `${INSTAGRAM_GRAPH_API_BASE}/${account.platformUserId}/media`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        media_type: 'REELS',
        video_url: videoUrl,
        caption: truncatedCaption,
        share_to_feed: 'true',
        access_token: accessToken,
      }),
    },
  );
  const container = await readInstagramResponse<InstagramApiResponse>(
    createResponse,
    'Instagram media container creation',
  );
  if (!container.id) {
    throw new Error('Instagram media container creation returned no ID');
  }

  await job.updateProgress(55);

  let isReady = false;
  for (let attempt = 0; attempt < MAX_STATUS_CHECKS; attempt++) {
    if (attempt > 0) await sleep(STATUS_POLL_INTERVAL_MS);

    const statusUrl = new URL(`${INSTAGRAM_GRAPH_API_BASE}/${container.id}`);
    statusUrl.search = new URLSearchParams({
      fields: 'status_code,status',
      access_token: accessToken,
    }).toString();
    const statusResponse = await fetch(statusUrl);
    const status = await readInstagramResponse<InstagramContainerStatus>(
      statusResponse,
      'Instagram media processing status',
    );

    if (
      status.status_code === 'FINISHED' ||
      status.status_code === 'PUBLISHED'
    ) {
      isReady = true;
      break;
    }
    if (status.status_code === 'ERROR' || status.status_code === 'EXPIRED') {
      throw new Error(
        `Instagram media processing ${status.status_code.toLowerCase()}: ${status.status ?? 'unknown error'}`,
      );
    }

    await job.updateProgress(
      55 + Math.round(((attempt + 1) / MAX_STATUS_CHECKS) * 25),
    );
  }

  if (!isReady) {
    throw new Error('Instagram media processing timed out after 5 minutes');
  }

  const publishResponse = await fetch(
    `${INSTAGRAM_GRAPH_API_BASE}/${account.platformUserId}/media_publish`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        creation_id: container.id,
        access_token: accessToken,
      }),
    },
  );
  const published = await readInstagramResponse<InstagramApiResponse>(
    publishResponse,
    'Instagram media publish',
  );
  if (!published.id) {
    throw new Error('Instagram media publish returned no ID');
  }

  await job.updateProgress(85);

  return {
    id: published.id,
    permalink: await fetchPermalink(published.id, accessToken),
  };
}

// The Reel is already live at this point, so a failed permalink lookup must not
// fail the job — we just lose the deep link to the post.
async function fetchPermalink(
  mediaId: string,
  accessToken: string,
): Promise<string | null> {
  try {
    const url = new URL(`${INSTAGRAM_GRAPH_API_BASE}/${mediaId}`);
    url.search = new URLSearchParams({
      fields: 'permalink',
      access_token: accessToken,
    }).toString();

    const response = await fetch(url);
    const media = await readInstagramResponse<InstagramApiResponse>(
      response,
      'Instagram permalink lookup',
    );
    return media.permalink ?? null;
  } catch (error) {
    console.error(
      `Failed to read Instagram permalink for media ${mediaId}:`,
      error instanceof Error ? error.message : error,
    );
    return null;
  }
}

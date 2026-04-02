import { Job } from 'bullmq';
import type { VideoJob } from '@clipflow/shared';
import { prisma } from '@clipflow/db';

const TIKTOK_API_BASE = 'https://open.tiktokapis.com/v2';

async function refreshAccessToken(platformAccountId: string): Promise<string> {
  const account = await prisma.platformAccount.findUnique({
    where: { id: platformAccountId },
  });
  if (!account?.accessToken) {
    throw new Error('Missing TikTok access token');
  }

  const now = new Date();
  const fiveMinutesFromNow = new Date(now.getTime() + 5 * 60 * 1000);

  if (
    account.tokenExpiresAt &&
    account.tokenExpiresAt < fiveMinutesFromNow &&
    account.refreshToken
  ) {
    const res = await fetch(`${TIKTOK_API_BASE}/oauth/token/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_key: process.env.TIKTOK_CLIENT_KEY!,
        client_secret: process.env.TIKTOK_CLIENT_SECRET!,
        grant_type: 'refresh_token',
        refresh_token: account.refreshToken,
      }),
    });

    if (!res.ok) {
      const body: any = await res.json().catch(() => null);
      const errorCode = body?.error ?? body?.error_description ?? '';
      if (
        res.status === 400 ||
        /invalid_grant|scope_not_authorized/i.test(String(errorCode))
      ) {
        await prisma.platformAccount.update({
          where: { id: platformAccountId },
          data: { tokenStatus: 'expired' },
        });
      }
      throw new Error(`TikTok token refresh failed: ${res.status} ${JSON.stringify(body)}`);
    }
    const data: any = await res.json();

    if (!data.access_token) {
      const errorCode = data.error ?? data.error_description ?? '';
      if (/invalid_grant|scope_not_authorized/i.test(String(errorCode))) {
        await prisma.platformAccount.update({
          where: { id: platformAccountId },
          data: {
            tokenStatus: /scope_not_authorized/i.test(String(errorCode))
              ? 'scope_error'
              : 'expired',
          },
        });
      }
      throw new Error(`TikTok token refresh returned no access_token: ${JSON.stringify(data)}`);
    }

    await prisma.platformAccount.update({
      where: { id: platformAccountId },
      data: {
        accessToken: data.access_token,
        refreshToken: data.refresh_token ?? account.refreshToken,
        tokenExpiresAt: data.expires_in
          ? new Date(Date.now() + data.expires_in * 1000)
          : undefined,
      },
    });

    return data.access_token;
  }

  return account.accessToken;
}

interface TikTokVideo {
  id: string;
  title?: string;
  video_description?: string;
  duration: number;
  cover_image_url?: string;
  share_url: string;
  create_time: number;
  like_count?: number;
  comment_count?: number;
  share_count?: number;
  view_count?: number;
}

export async function handleTikTokSync(job: Job<VideoJob>) {
  const { platformAccountId } = job.data as any;

  const account = await prisma.platformAccount.findUniqueOrThrow({
    where: { id: platformAccountId },
  });

  console.log(`[TikTok Sync] Starting sync for account ${account.platformUserId} (${account.displayName})`);
  const accessToken = await refreshAccessToken(account.id);
  console.log(`[TikTok Sync] Got access token (expires: ${account.tokenExpiresAt?.toISOString() ?? 'unknown'})`);

  await job.updateProgress(10);

  // Paginate through all videos using cursor-based pagination
  const allVideos: TikTokVideo[] = [];
  let cursor: number | undefined;
  let hasMore = true;

  while (hasMore) {
    const body: Record<string, unknown> = { max_count: 20 };
    if (cursor !== undefined) {
      body.cursor = cursor;
    }

    const res = await fetch(
      `${TIKTOK_API_BASE}/video/list/?fields=id,title,video_description,duration,cover_image_url,share_url,create_time,like_count,comment_count,share_count,view_count`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      }
    );

    const responseText = await res.text();
    console.log(`[TikTok Sync] API response status: ${res.status}`);
    console.log(`[TikTok Sync] API response body: ${responseText}`);

    if (!res.ok) {
      throw new Error(`TikTok video list failed: ${res.status} - ${responseText}`);
    }

    let data: any;
    try {
      data = JSON.parse(responseText);
    } catch {
      throw new Error(`TikTok API returned invalid JSON: ${responseText.substring(0, 500)}`);
    }

    if (data.error?.code !== 'ok' && data.error?.code) {
      throw new Error(`TikTok API error: ${data.error.code} - ${data.error.message} (full response: ${responseText.substring(0, 500)})`);
    }

    const videos = data.data?.videos ?? [];
    console.log(`[TikTok Sync] Page returned ${videos.length} videos, has_more: ${data.data?.has_more}, cursor: ${data.data?.cursor}`);
    allVideos.push(...videos);

    hasMore = data.data?.has_more ?? false;
    cursor = data.data?.cursor;
  }

  await job.updateProgress(30);

  if (allVideos.length === 0) {
    console.log(`[TikTok Sync] No videos returned by TikTok API for account ${account.platformUserId}. This likely means the video.list scope hasn't been approved in the TikTok Developer Portal.`);
    await job.updateProgress(100);
    return;
  }

  await job.updateProgress(40);

  // Upsert each video
  let synced = 0;
  for (let i = 0; i < allVideos.length; i++) {
    const video = allVideos[i];
    const sourceUrl = video.share_url;
    const title = video.title || video.video_description
      ? (video.title || video.video_description!).split('\n')[0].substring(0, 200)
      : null;

    const existing = await prisma.video.findFirst({
      where: { userId: account.userId, sourceUrl },
    });

    if (!existing) {
      await prisma.video.create({
        data: {
          userId: account.userId,
          sourceUrl,
          title,
          description: video.video_description ?? null,
          duration: video.duration,
          thumbnailUrl: video.cover_image_url ?? null,
          status: 'PENDING',
          platform: 'TIKTOK',
          platformMediaId: video.id,
          viewCount: video.view_count ?? null,
          likeCount: video.like_count ?? null,
          commentCount: video.comment_count ?? null,
          shareCount: video.share_count ?? null,
        },
      });
      synced++;
    } else {
      await prisma.video.update({
        where: { id: existing.id },
        data: {
          title: title ?? existing.title,
          description: video.video_description ?? existing.description,
          duration: video.duration,
          thumbnailUrl: video.cover_image_url ?? existing.thumbnailUrl,
          platform: 'TIKTOK',
          platformMediaId: video.id,
          viewCount: video.view_count ?? existing.viewCount,
          likeCount: video.like_count ?? existing.likeCount,
          commentCount: video.comment_count ?? existing.commentCount,
          shareCount: video.share_count ?? existing.shareCount,
        },
      });
    }

    // Update progress proportionally (40-90% range for video processing)
    const progress = 40 + Math.round(((i + 1) / allVideos.length) * 50);
    await job.updateProgress(progress);
  }

  // Update last synced timestamp
  await prisma.platformAccount.update({
    where: { id: account.id },
    data: { lastSyncedAt: new Date() },
  });

  await job.updateProgress(100);
  console.log(
    `TikTok sync complete for ${account.platformUserId}: ${synced} new videos, ${allVideos.length - synced} updated`
  );
}

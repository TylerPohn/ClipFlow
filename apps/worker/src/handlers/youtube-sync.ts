import { Job } from 'bullmq';
import type { VideoJob } from '@clipflow/shared';
import { prisma } from '@clipflow/db';

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const YOUTUBE_API_BASE = 'https://www.googleapis.com/youtube/v3';

async function refreshAccessToken(platformAccountId: string): Promise<string> {
  const platformAccount = await prisma.platformAccount.findUnique({
    where: { id: platformAccountId },
  });
  if (!platformAccount?.accessToken) {
    throw new Error('Missing YouTube access token');
  }

  const now = new Date();
  const fiveMinutesFromNow = new Date(now.getTime() + 5 * 60 * 1000);

  if (
    platformAccount.tokenExpiresAt &&
    platformAccount.tokenExpiresAt < fiveMinutesFromNow &&
    platformAccount.refreshToken
  ) {
    const res = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID!,
        client_secret: process.env.GOOGLE_CLIENT_SECRET!,
        refresh_token: platformAccount.refreshToken,
        grant_type: 'refresh_token',
      }),
    });

    if (!res.ok) throw new Error(`Token refresh failed: ${res.status}`);
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

  return platformAccount.accessToken;
}

function parseDuration(iso: string): number {
  const match = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return 0;
  return (
    parseInt(match[1] ?? '0', 10) * 3600 +
    parseInt(match[2] ?? '0', 10) * 60 +
    parseInt(match[3] ?? '0', 10)
  );
}

export async function handleYouTubeSync(job: Job<VideoJob>) {
  const { userId, options } = job.data;
  const channelId = options?.channelId as string;
  const platformAccountId = options?.platformAccountId as string | undefined;
  const specificVideoId = options?.specificVideoId as string | undefined;

  if (!channelId) throw new Error('Missing channelId in job options');

  // Find PlatformAccount — prefer by ID if provided, otherwise look up by channelId
  let platformAccount;
  if (platformAccountId) {
    platformAccount = await prisma.platformAccount.findUnique({
      where: { id: platformAccountId },
    });
  }
  if (!platformAccount) {
    platformAccount = await prisma.platformAccount.findFirst({
      where: { userId, platform: 'YOUTUBE', platformUserId: channelId },
    });
  }
  if (!platformAccount) throw new Error(`YouTube PlatformAccount for channel ${channelId} not found`);

  const accessToken = await refreshAccessToken(platformAccount.id);

  await job.updateProgress(10);

  const metadata = platformAccount.metadata as { uploadsPlaylistId?: string } | null;
  const uploadsPlaylistId = metadata?.uploadsPlaylistId;

  let videoIds: string[];

  if (specificVideoId) {
    // Sync a single video (from PubSubHubbub notification)
    videoIds = [specificVideoId];
  } else {
    if (!uploadsPlaylistId) {
      throw new Error('Missing uploadsPlaylistId in PlatformAccount metadata');
    }

    // Full sync: list all videos from uploads playlist (paginate through all pages)
    videoIds = [];
    let plPageToken: string | undefined;
    do {
      const plParams = new URLSearchParams({
        part: 'contentDetails',
        playlistId: uploadsPlaylistId,
        maxResults: '50',
      });
      if (plPageToken) plParams.set('pageToken', plPageToken);

      const playlistRes = await fetch(
        `${YOUTUBE_API_BASE}/playlistItems?${plParams}`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );

      if (!playlistRes.ok) {
        throw new Error(`playlistItems.list failed: ${playlistRes.status}`);
      }

      const playlistData = await playlistRes.json();
      const pageIds = (playlistData.items ?? []).map(
        (item: { contentDetails: { videoId: string } }) => item.contentDetails.videoId
      );
      videoIds.push(...pageIds);
      plPageToken = playlistData.nextPageToken;
    } while (plPageToken);

    // Deduplicate (YouTube API can return overlapping results across pages)
    videoIds = [...new Set(videoIds)];
  }

  if (videoIds.length === 0) {
    console.log('No videos found to sync');
    await job.updateProgress(100);
    return;
  }

  await job.updateProgress(30);

  // Get full video details (batched in chunks of 50)
  const videos: Array<Record<string, unknown>> = [];
  for (let i = 0; i < videoIds.length; i += 50) {
    const batch = videoIds.slice(i, i + 50);
    const videosRes = await fetch(
      `${YOUTUBE_API_BASE}/videos?part=snippet,statistics,contentDetails&id=${batch.join(',')}`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );

    if (!videosRes.ok) {
      throw new Error(`videos.list failed: ${videosRes.status}`);
    }

    const videosData = await videosRes.json();
    videos.push(...(videosData.items ?? []));
  }

  await job.updateProgress(60);

  // Upsert each video into the database
  let synced = 0;
  for (const video of videos) {
    const sourceUrl = `https://www.youtube.com/watch?v=${video.id}`;
    const duration = parseDuration(video.contentDetails.duration);
    const thumbnailUrl =
      video.snippet.thumbnails?.maxres?.url ??
      video.snippet.thumbnails?.high?.url ??
      video.snippet.thumbnails?.default?.url ??
      null;

    // Check if already imported
    const existing = await prisma.video.findFirst({
      where: { userId, sourceUrl },
    });

    const viewCount = parseInt(video.statistics?.viewCount ?? '0', 10);
    const likeCount = parseInt(video.statistics?.likeCount ?? '0', 10);
    const commentCount = parseInt(video.statistics?.commentCount ?? '0', 10);

    if (!existing) {
      await prisma.video.create({
        data: {
          userId,
          sourceUrl,
          title: video.snippet.title,
          description: video.snippet.description ?? null,
          duration,
          thumbnailUrl,
          platform: 'YOUTUBE',
          platformMediaId: video.id,
          viewCount,
          likeCount,
          commentCount,
          status: 'PENDING',
        },
      });
      synced++;
    } else {
      // Update metadata for existing videos
      await prisma.video.update({
        where: { id: existing.id },
        data: {
          title: video.snippet.title,
          description: video.snippet.description ?? null,
          duration,
          thumbnailUrl: thumbnailUrl ?? existing.thumbnailUrl,
          platform: 'YOUTUBE',
          platformMediaId: video.id,
          viewCount,
          likeCount,
          commentCount,
        },
      });
    }
  }

  // Update last synced timestamp on PlatformAccount
  await prisma.platformAccount.update({
    where: { id: platformAccount.id },
    data: { lastSyncedAt: new Date() },
  });

  await job.updateProgress(100);
  console.log(`YouTube sync complete for ${channelId}: ${synced} new videos, ${videos.length - synced} updated`);
}

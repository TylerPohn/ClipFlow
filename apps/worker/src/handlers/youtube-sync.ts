import { Job } from 'bullmq';
import type { VideoJob } from '@clipflow/shared';
import { prisma } from '@clipflow/db';

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const YOUTUBE_API_BASE = 'https://www.googleapis.com/youtube/v3';

async function refreshAccessToken(accountId: string): Promise<string> {
  const account = await prisma.account.findUnique({ where: { id: accountId } });
  if (!account?.access_token) {
    throw new Error('Missing YouTube access token');
  }

  const now = Math.floor(Date.now() / 1000);
  if (account.expires_at && account.expires_at < now + 300 && account.refresh_token) {
    const res = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID!,
        client_secret: process.env.GOOGLE_CLIENT_SECRET!,
        refresh_token: account.refresh_token,
        grant_type: 'refresh_token',
      }),
    });

    if (!res.ok) throw new Error(`Token refresh failed: ${res.status}`);
    const data = await res.json();

    await prisma.account.update({
      where: { id: accountId },
      data: {
        access_token: data.access_token,
        expires_at: Math.floor(Date.now() / 1000) + data.expires_in,
        ...(data.refresh_token ? { refresh_token: data.refresh_token } : {}),
      },
    });

    return data.access_token;
  }

  return account.access_token;
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
  const specificVideoId = options?.specificVideoId as string | undefined;

  if (!channelId) throw new Error('Missing channelId in job options');

  const channel = await prisma.youTubeChannel.findUnique({ where: { channelId } });
  if (!channel) throw new Error(`YouTube channel ${channelId} not found`);

  const account = await prisma.account.findFirst({
    where: { userId, provider: 'google-youtube' },
  });
  if (!account) throw new Error('No YouTube account linked');

  const accessToken = await refreshAccessToken(account.id);

  await job.updateProgress(10);

  let videoIds: string[];

  if (specificVideoId) {
    // Sync a single video (from PubSubHubbub notification)
    videoIds = [specificVideoId];
  } else {
    // Full sync: list all videos from uploads playlist
    const playlistRes = await fetch(
      `${YOUTUBE_API_BASE}/playlistItems?part=contentDetails&playlistId=${channel.uploadsPlaylistId}&maxResults=50`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );

    if (!playlistRes.ok) {
      throw new Error(`playlistItems.list failed: ${playlistRes.status}`);
    }

    const playlistData = await playlistRes.json();
    videoIds = (playlistData.items ?? []).map(
      (item: { contentDetails: { videoId: string } }) => item.contentDetails.videoId
    );
  }

  if (videoIds.length === 0) {
    console.log('No videos found to sync');
    await job.updateProgress(100);
    return;
  }

  await job.updateProgress(30);

  // Get full video details (batched, up to 50)
  const videosRes = await fetch(
    `${YOUTUBE_API_BASE}/videos?part=snippet,statistics,contentDetails&id=${videoIds.join(',')}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );

  if (!videosRes.ok) {
    throw new Error(`videos.list failed: ${videosRes.status}`);
  }

  const videosData = await videosRes.json();
  const videos = videosData.items ?? [];

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

    if (!existing) {
      await prisma.video.create({
        data: {
          userId,
          sourceUrl,
          title: video.snippet.title,
          description: video.snippet.description ?? null,
          duration,
          thumbnailUrl,
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
        },
      });
    }
  }

  // Update last synced timestamp
  await prisma.youTubeChannel.update({
    where: { channelId },
    data: { lastSyncedAt: new Date() },
  });

  await job.updateProgress(100);
  console.log(`YouTube sync complete for ${channelId}: ${synced} new videos, ${videos.length - synced} updated`);
}

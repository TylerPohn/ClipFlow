import { Job } from 'bullmq';
import type { VideoJob } from '@clipflow/shared';
import { prisma } from '@clipflow/db';
import {
  ensureFreshInstagramToken,
  INSTAGRAM_GRAPH_API_BASE,
} from '../lib/instagram-token';

interface IGMedia {
  id: string;
  caption?: string;
  media_type: string;
  media_url?: string;
  thumbnail_url?: string;
  permalink: string;
  timestamp: string;
}

interface IGInsightValue {
  value: number;
}

interface IGInsight {
  name: string;
  values: IGInsightValue[];
}

async function fetchMediaInsights(
  mediaId: string,
  accessToken: string,
): Promise<{ views: number; likes: number; comments: number; shares: number }> {
  const stats = { views: 0, likes: 0, comments: 0, shares: 0 };

  try {
    const res = await fetch(
      `${INSTAGRAM_GRAPH_API_BASE}/${mediaId}/insights?metric=plays,likes,comments,shares&access_token=${accessToken}`,
    );

    if (!res.ok) {
      console.log(`Insights unavailable for media ${mediaId}: ${res.status}`);
      return stats;
    }

    const data = (await res.json()) as { data?: IGInsight[] };
    for (const insight of (data.data ?? []) as IGInsight[]) {
      const value = insight.values?.[0]?.value ?? 0;
      switch (insight.name) {
        case 'plays':
          stats.views = value;
          break;
        case 'likes':
          stats.likes = value;
          break;
        case 'comments':
          stats.comments = value;
          break;
        case 'shares':
          stats.shares = value;
          break;
      }
    }
  } catch (err) {
    console.log(`Failed to fetch insights for media ${mediaId}:`, err);
  }

  return stats;
}

export async function handleInstagramSync(job: Job<VideoJob>) {
  const { platformAccountId } = job.data as any;

  const account = await prisma.platformAccount.findUniqueOrThrow({
    where: { id: platformAccountId },
  });

  const igUserId = account.platformUserId;
  const accessToken = await ensureFreshInstagramToken(account.id);

  await job.updateProgress(10);

  // Paginate through all media
  const allMedia: IGMedia[] = [];
  let url: string | null =
    `${INSTAGRAM_GRAPH_API_BASE}/${igUserId}/media?fields=id,caption,media_type,media_url,thumbnail_url,permalink,timestamp&limit=50&access_token=${accessToken}`;

  while (url) {
    const res = await fetch(url);
    if (!res.ok) {
      const errorBody = await res.text();
      console.error(`Instagram media fetch failed: ${res.status}`, errorBody);
      throw new Error(
        `Instagram media fetch failed: ${res.status} - ${errorBody}`,
      );
    }
    const data = (await res.json()) as {
      data?: IGMedia[];
      paging?: { next?: string };
    };
    allMedia.push(...(data.data ?? []));
    url = data.paging?.next ?? null;
  }

  await job.updateProgress(30);

  // Filter for video content only
  const videos = allMedia.filter(
    (m) => m.media_type === 'VIDEO' || m.media_type === 'REEL',
  );

  if (videos.length === 0) {
    console.log('No Instagram videos found to sync');
    await job.updateProgress(100);
    return;
  }

  await job.updateProgress(40);

  // Upsert each video
  let synced = 0;
  for (let i = 0; i < videos.length; i++) {
    const media = videos[i];
    const sourceUrl = media.permalink;
    const title = media.caption
      ? media.caption.split('\n')[0].substring(0, 200)
      : null;

    // Fetch engagement stats
    const stats = await fetchMediaInsights(media.id, accessToken);

    const existing = await prisma.video.findFirst({
      where: { userId: account.userId, sourceUrl },
    });

    if (!existing) {
      await prisma.video.create({
        data: {
          userId: account.userId,
          sourceUrl,
          title,
          description: media.caption ?? null,
          thumbnailUrl: media.thumbnail_url ?? media.media_url ?? null,
          status: 'PENDING',
          platform: 'INSTAGRAM',
          platformMediaId: media.id,
          viewCount: stats.views,
          likeCount: stats.likes,
          commentCount: stats.comments,
          shareCount: stats.shares,
        },
      });
      synced++;
    } else {
      await prisma.video.update({
        where: { id: existing.id },
        data: {
          title: title ?? existing.title,
          description: media.caption ?? existing.description,
          thumbnailUrl:
            media.thumbnail_url ?? media.media_url ?? existing.thumbnailUrl,
          platform: 'INSTAGRAM',
          platformMediaId: media.id,
          viewCount: stats.views,
          likeCount: stats.likes,
          commentCount: stats.comments,
          shareCount: stats.shares,
        },
      });
    }

    // Update progress proportionally (40-90% range for video processing)
    const progress = 40 + Math.round(((i + 1) / videos.length) * 50);
    await job.updateProgress(progress);
  }

  // Update last synced timestamp
  await prisma.platformAccount.update({
    where: { id: account.id },
    data: { lastSyncedAt: new Date() },
  });

  await job.updateProgress(100);
  console.log(
    `Instagram sync complete for ${igUserId}: ${synced} new videos, ${videos.length - synced} updated`,
  );
}

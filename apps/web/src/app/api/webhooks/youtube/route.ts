import { NextResponse } from 'next/server';
import { prisma } from '@clipflow/db';
import { videoQueue } from '@/lib/queue';
import { JobType } from '@clipflow/shared';

/**
 * GET: PubSubHubbub verification challenge.
 * Google sends hub.challenge as a query param; we echo it back.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const challenge = searchParams.get('hub.challenge');

  if (challenge) {
    return new NextResponse(challenge, {
      status: 200,
      headers: { 'Content-Type': 'text/plain' },
    });
  }

  return NextResponse.json({ error: 'Missing challenge' }, { status: 400 });
}

/**
 * POST: PubSubHubbub notification when a new video is uploaded.
 * Google POSTs Atom XML with video ID and channel ID.
 */
export async function POST(request: Request) {
  const body = await request.text();

  // Parse video ID and channel ID from Atom XML
  const videoIdMatch = body.match(/<yt:videoId>([^<]+)<\/yt:videoId>/);
  const channelIdMatch = body.match(/<yt:channelId>([^<]+)<\/yt:channelId>/);

  if (!videoIdMatch || !channelIdMatch) {
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
  }

  const videoId = videoIdMatch[1];
  const channelId = channelIdMatch[1];

  // Look up the PlatformAccount by YouTube channel ID
  const platformAccount = await prisma.platformAccount.findFirst({
    where: { platform: 'YOUTUBE', platformUserId: channelId },
  });

  if (!platformAccount) {
    // Channel not linked to any user — ignore
    return NextResponse.json({ status: 'ignored' });
  }

  // Check if we already have this video imported
  const existing = await prisma.video.findFirst({
    where: {
      userId: platformAccount.userId,
      sourceUrl: { contains: videoId },
    },
  });

  if (!existing) {
    // Enqueue sync for this specific video
    await videoQueue.add(`youtube-sync-${videoId}`, {
      type: JobType.YOUTUBE_SYNC,
      videoId: '',
      userId: platformAccount.userId,
      options: { channelId, platformAccountId: platformAccount.id, specificVideoId: videoId },
    });
  }

  return NextResponse.json({ status: 'ok' });
}

import { NextResponse } from 'next/server';
import { getServerSession } from '@/lib/auth';
import { prisma } from '@clipflow/db';
import {
  getValidAccessToken,
  listUploadedVideoIds,
  getVideoDetails,
  parseDuration,
} from '@/lib/youtube';

export async function GET(request: Request) {
  const session = await getServerSession();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const userId = (session.user as { id: string }).id;
  const { searchParams } = new URL(request.url);
  const pageToken = searchParams.get('pageToken') ?? undefined;
  const maxResults = Math.min(
    parseInt(searchParams.get('maxResults') ?? '50', 10),
    50
  );

  // 1. Find the user's YouTube channel
  const ytChannel = await prisma.youTubeChannel.findFirst({
    where: { userId },
  });
  if (!ytChannel) {
    return NextResponse.json(
      { error: 'No YouTube channel linked' },
      { status: 400 }
    );
  }

  // 2. Find the user's google-youtube account
  const account = await prisma.account.findFirst({
    where: { userId, provider: 'google-youtube' },
  });
  if (!account) {
    return NextResponse.json(
      { error: 'No YouTube account found' },
      { status: 400 }
    );
  }

  // 3. Get a valid access token
  const accessToken = await getValidAccessToken(account.id);

  // 4. List uploaded video IDs from the channel's uploads playlist
  const { videoIds, nextPageToken } = await listUploadedVideoIds(
    accessToken,
    ytChannel.uploadsPlaylistId,
    maxResults,
    pageToken
  );

  if (videoIds.length === 0) {
    return NextResponse.json({
      videos: [],
      nextPageToken: nextPageToken ?? null,
      channel: {
        channelName: ytChannel.channelName,
        channelHandle: ytChannel.channelHandle,
        thumbnailUrl: ytChannel.thumbnailUrl,
      },
    });
  }

  // 5. Get full video details from YouTube API
  const ytVideos = await getVideoDetails(accessToken, videoIds);

  // 6. Check which videos are already imported in ClipFlow
  const sourceUrls = ytVideos.map(
    (v) => `https://www.youtube.com/watch?v=${v.videoId}`
  );

  const importedVideos = await prisma.video.findMany({
    where: {
      userId,
      sourceUrl: { in: sourceUrls },
    },
    select: {
      id: true,
      sourceUrl: true,
    },
  });

  const importedMap = new Map(
    importedVideos.map((v) => [v.sourceUrl, v.id])
  );

  // 7. Combine and return
  const videos = ytVideos.map((v) => {
    const url = `https://www.youtube.com/watch?v=${v.videoId}`;
    const clipflowVideoId = importedMap.get(url) ?? null;
    return {
      videoId: v.videoId,
      title: v.title,
      description: v.description,
      thumbnailUrl: v.thumbnailUrl,
      duration: parseDuration(v.duration),
      publishedAt: v.publishedAt,
      viewCount: v.viewCount,
      likeCount: v.likeCount,
      imported: clipflowVideoId !== null,
      clipflowVideoId,
    };
  });

  return NextResponse.json({
    videos,
    nextPageToken: nextPageToken ?? null,
    channel: {
      channelName: ytChannel.channelName,
      channelHandle: ytChannel.channelHandle,
      thumbnailUrl: ytChannel.thumbnailUrl,
    },
  });
}

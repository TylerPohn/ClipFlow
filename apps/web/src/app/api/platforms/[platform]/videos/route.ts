import { NextResponse } from 'next/server';
import { getServerSession } from '@/lib/auth';
import { prisma } from '@clipflow/db';
import {
  getValidAccessToken,
  listUploadedVideoIds,
  getVideoDetails,
  parseDuration,
} from '@/lib/youtube';

const VALID_PLATFORMS = ['YOUTUBE', 'TIKTOK', 'INSTAGRAM', 'X'];

export async function GET(
  request: Request,
  { params }: { params: Promise<{ platform: string }> }
) {
  const session = await getServerSession();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const userId = (session.user as { id: string }).id;
  const { platform: rawPlatform } = await params;
  const platform = rawPlatform.toUpperCase();

  if (!VALID_PLATFORMS.includes(platform)) {
    return NextResponse.json({ error: 'Invalid platform' }, { status: 400 });
  }

  const { searchParams } = new URL(request.url);
  const pageToken = searchParams.get('pageToken') ?? undefined;
  const maxResults = Math.min(
    parseInt(searchParams.get('maxResults') ?? '50', 10),
    50
  );

  if (platform === 'YOUTUBE') {
    // Delegate to YouTube logic
    const platformAccount = await prisma.platformAccount.findFirst({
      where: { userId, platform: 'YOUTUBE' },
    });
    if (!platformAccount) {
      return NextResponse.json(
        { error: 'No YouTube channel linked' },
        { status: 400 }
      );
    }

    const accessToken = await getValidAccessToken(platformAccount.id);

    const metadata = platformAccount.metadata as { uploadsPlaylistId?: string } | null;
    const uploadsPlaylistId = metadata?.uploadsPlaylistId;
    if (!uploadsPlaylistId) {
      return NextResponse.json(
        { error: 'Missing uploads playlist ID' },
        { status: 400 }
      );
    }

    const { videoIds, nextPageToken } = await listUploadedVideoIds(
      accessToken,
      uploadsPlaylistId,
      maxResults,
      pageToken
    );

    if (videoIds.length === 0) {
      return NextResponse.json({
        videos: [],
        nextPageToken: nextPageToken ?? null,
        channel: {
          channelName: platformAccount.displayName,
          channelHandle: platformAccount.handle,
          thumbnailUrl: platformAccount.avatarUrl,
        },
      });
    }

    const ytVideos = await getVideoDetails(accessToken, videoIds);

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
        channelName: platformAccount.displayName,
        channelHandle: platformAccount.handle,
        thumbnailUrl: platformAccount.avatarUrl,
      },
    });
  }

  // For other platforms, sync/browse not yet available
  return NextResponse.json({
    videos: [],
    nextPageToken: null,
    message: 'Sync not available for this platform yet',
  });
}

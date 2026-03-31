import { NextResponse } from 'next/server';
import { getServerSession } from '@/lib/auth';
import { prisma } from '@clipflow/db';

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

  // All platforms (including YouTube) — return synced videos from the database
  const platformAccount = await prisma.platformAccount.findFirst({
    where: { userId, platform },
  });

  if (!platformAccount) {
    return NextResponse.json(
      { error: `No ${platform} account linked` },
      { status: 400 }
    );
  }

  const skip = pageToken ? parseInt(pageToken, 10) : 0;

  // For YouTube, also match videos with platform=null that have YouTube sourceUrls
  // (from before the sync handler set the platform field)
  const videoWhere =
    platform === 'YOUTUBE'
      ? {
          userId,
          OR: [
            { platform: 'YOUTUBE' },
            { platform: null, sourceUrl: { startsWith: 'https://www.youtube.com/watch' } },
          ],
        }
      : { userId, platform };

  const [videos, totalCount] = await Promise.all([
    prisma.video.findMany({
      where: videoWhere,
      orderBy: { createdAt: 'desc' },
      skip,
      take: maxResults,
      select: {
        id: true,
        sourceUrl: true,
        title: true,
        description: true,
        thumbnailUrl: true,
        duration: true,
        viewCount: true,
        likeCount: true,
        commentCount: true,
        shareCount: true,
        platformMediaId: true,
        createdAt: true,
      },
    }),
    prisma.video.count({ where: videoWhere }),
  ]);

  const nextSkip = skip + maxResults;
  const nextPageTokenValue = nextSkip < totalCount ? String(nextSkip) : null;

  const accountInfo = {
    displayName: platformAccount.displayName,
    handle: platformAccount.handle,
    avatarUrl: platformAccount.avatarUrl,
  };

  return NextResponse.json({
    videos: videos.map((v) => ({
      videoId: v.platformMediaId ?? v.id,
      title: v.title,
      description: v.description,
      thumbnailUrl: v.thumbnailUrl,
      duration: v.duration,
      publishedAt: v.createdAt.toISOString(),
      viewCount: v.viewCount,
      likeCount: v.likeCount,
      commentCount: v.commentCount,
      shareCount: v.shareCount,
      imported: true,
      clipflowVideoId: v.id,
    })),
    nextPageToken: nextPageTokenValue,
    // Return both shapes so the frontend works for all platforms
    channel: {
      channelName: accountInfo.displayName,
      channelHandle: accountInfo.handle,
      thumbnailUrl: accountInfo.avatarUrl,
    },
    account: accountInfo,
  });
}

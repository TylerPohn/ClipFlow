import { NextResponse } from 'next/server';
import { getServerSession } from '@/lib/auth';
import { prisma } from '@clipflow/db';
import { getValidAccessToken, getVideoComments } from '@/lib/youtube';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ videoId: string }> }
) {
  const session = await getServerSession();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const userId = (session.user as { id: string }).id;
  const { videoId } = await params;

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

  const { searchParams } = new URL(request.url);
  const pageToken = searchParams.get('pageToken') ?? undefined;
  const maxResults = Math.min(
    parseInt(searchParams.get('maxResults') ?? '50', 10),
    100
  );

  const { comments, nextPageToken } = await getVideoComments(
    accessToken,
    videoId,
    maxResults,
    pageToken
  );

  return NextResponse.json({
    comments,
    nextPageToken: nextPageToken ?? null,
  });
}

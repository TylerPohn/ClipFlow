import { NextResponse } from 'next/server';
import { getServerSession } from '@/lib/auth';
import { prisma } from '@clipflow/db';
import { S3_BUCKETS, VideoStatus } from '@clipflow/shared';
import { getSignedUrl } from '@clipflow/shared/src/s3';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const userId = (session.user as { id: string }).id;
  const { id } = await params;

  const video = await prisma.video.findFirst({
    where: { id, userId },
  });

  if (!video) {
    return NextResponse.json({ error: 'Video not found' }, { status: 404 });
  }

  if (video.status !== VideoStatus.READY || !video.processedStorageKey) {
    return NextResponse.json(
      { error: 'Video is not ready for download' },
      { status: 400 }
    );
  }

  const url = await getSignedUrl(S3_BUCKETS.PROCESSED, video.processedStorageKey);

  return NextResponse.json({
    url,
    expiresIn: 3600,
  });
}

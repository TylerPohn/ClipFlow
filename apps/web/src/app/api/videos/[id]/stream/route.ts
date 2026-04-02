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

  // Return processed video if ready, otherwise fall back to raw
  const storageKey = video.status === VideoStatus.READY && video.processedStorageKey
    ? video.processedStorageKey
    : video.rawStorageKey;

  if (!storageKey) {
    return NextResponse.json(
      { error: 'No video file available' },
      { status: 400 }
    );
  }

  const bucket = video.status === VideoStatus.READY && video.processedStorageKey
    ? S3_BUCKETS.PROCESSED
    : S3_BUCKETS.RAW;

  const url = await getSignedUrl(bucket, storageKey);

  return NextResponse.json({ url, expiresIn: 3600 });
}

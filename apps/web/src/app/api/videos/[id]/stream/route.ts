import { NextResponse } from 'next/server';
import { getServerSession } from '@/lib/auth';
import { prisma } from '@clipflow/db';
import { S3_BUCKETS, VideoStatus } from '@clipflow/shared';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const s3 = new S3Client({
  region: process.env.AWS_REGION ?? 'us-east-1',
});

const PRESIGNED_URL_EXPIRES_IN = 3600; // 1 hour

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

  const command = new GetObjectCommand({
    Bucket: bucket,
    Key: storageKey,
    ResponseContentType: 'video/mp4',
  });

  const url = await getSignedUrl(s3, command, {
    expiresIn: PRESIGNED_URL_EXPIRES_IN,
  });

  return NextResponse.json({ url, expiresIn: PRESIGNED_URL_EXPIRES_IN });
}

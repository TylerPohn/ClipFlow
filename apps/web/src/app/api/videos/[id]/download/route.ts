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

  if (video.status !== VideoStatus.READY || !video.processedStorageKey) {
    return NextResponse.json(
      { error: 'Video is not ready for download' },
      { status: 400 }
    );
  }

  const filename = (video.title ?? 'video').replace(/[^a-zA-Z0-9_\-. ]/g, '') + '.mp4';

  const command = new GetObjectCommand({
    Bucket: S3_BUCKETS.PROCESSED,
    Key: video.processedStorageKey,
    ResponseContentDisposition: `attachment; filename="${filename}"`,
  });

  const url = await getSignedUrl(s3, command, {
    expiresIn: PRESIGNED_URL_EXPIRES_IN,
  });

  return NextResponse.json({
    url,
    expiresIn: PRESIGNED_URL_EXPIRES_IN,
  });
}

import { NextResponse } from 'next/server';
import { getServerSession } from '@/lib/auth';
import { prisma } from '@clipflow/db';
import { S3_BUCKETS } from '@clipflow/shared';
import { getSignedUrl } from '@clipflow/shared/src/s3';

// Thumbnail URLs are persisted as presigned S3 URLs, which expire after at most
// 7 days. Re-sign on read so stored thumbnails keep resolving indefinitely.
function extractThumbnailKey(storedUrl: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(storedUrl);
  } catch {
    return null;
  }

  const path = decodeURIComponent(parsed.pathname).replace(/^\/+/, '');

  // Virtual-hosted style: <bucket>.<account>.r2.cloudflarestorage.com/<key>
  if (parsed.hostname.startsWith(`${S3_BUCKETS.THUMBNAILS}.`)) {
    return path || null;
  }

  // Path style (MinIO local dev): <host>/<bucket>/<key>
  const prefix = `${S3_BUCKETS.THUMBNAILS}/`;
  if (path.startsWith(prefix)) {
    return path.slice(prefix.length) || null;
  }

  return null;
}

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
    select: { thumbnailUrl: true },
  });

  if (!video?.thumbnailUrl) {
    return NextResponse.json({ error: 'Thumbnail not found' }, { status: 404 });
  }

  const key = extractThumbnailKey(video.thumbnailUrl);

  // Thumbnails imported from a platform CDN are not in our bucket; pass through.
  const url = key
    ? await getSignedUrl(S3_BUCKETS.THUMBNAILS, key, 3600)
    : video.thumbnailUrl;

  return NextResponse.redirect(url, {
    status: 307,
    headers: { 'Cache-Control': 'private, no-store' },
  });
}

import { NextResponse } from 'next/server';
import { getServerSession } from '@/lib/auth';
import { prisma } from '@clipflow/db';
import { JobType, VideoStatus } from '@clipflow/shared';
import { videoQueue } from '@/lib/queue';

const IMPORT_PLATFORMS = ['YOUTUBE'];

export async function POST(
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

  if (!IMPORT_PLATFORMS.includes(platform)) {
    return NextResponse.json(
      { error: 'Import not supported for this platform yet' },
      { status: 400 }
    );
  }

  const body = await request.json();

  if (platform === 'YOUTUBE') {
    const { videoId, title, description, thumbnailUrl, duration } = body;

    if (!videoId) {
      return NextResponse.json(
        { error: 'videoId is required' },
        { status: 400 }
      );
    }

    const sourceUrl = `https://www.youtube.com/watch?v=${videoId}`;

    const existingVideo = await prisma.video.findFirst({
      where: { userId, sourceUrl },
    });

    if (existingVideo) {
      return NextResponse.json(
        { error: 'Video already imported', id: existingVideo.id },
        { status: 409 }
      );
    }

    const video = await prisma.video.create({
      data: {
        userId,
        sourceUrl,
        title,
        description,
        thumbnailUrl,
        duration,
        status: VideoStatus.PENDING,
      },
    });

    await videoQueue.add(JobType.DOWNLOAD, {
      type: JobType.DOWNLOAD,
      videoId: video.id,
      userId,
      sourceUrl,
    });

    return NextResponse.json(
      { id: video.id, status: video.status },
      { status: 201 }
    );
  }

  return NextResponse.json(
    { error: 'Import not supported for this platform yet' },
    { status: 400 }
  );
}

import { NextResponse } from 'next/server';
import { getServerSession } from '@/lib/auth';
import { prisma } from '@clipflow/db';
import { JobType, VideoStatus } from '@clipflow/shared';
import { videoQueue } from '@/lib/queue';

export async function POST(request: Request) {
  const session = await getServerSession();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const userId = (session.user as { id: string }).id;

  const body = await request.json();
  const { youtubeVideoId, title, description, thumbnailUrl, duration } = body;

  if (!youtubeVideoId) {
    return NextResponse.json(
      { error: 'youtubeVideoId is required' },
      { status: 400 }
    );
  }

  const sourceUrl = `https://www.youtube.com/watch?v=${youtubeVideoId}`;

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

import { NextResponse } from 'next/server';
import { getServerSession } from '@/lib/auth';
import { prisma } from '@clipflow/db';
import { JobType, VideoStatus } from '@clipflow/shared';
import { videoQueue } from '@/lib/queue';

const YOUTUBE_URL_REGEX =
  /^https?:\/\/(www\.)?(youtube\.com\/(watch\?v=|shorts\/)|youtu\.be\/)/;

export async function POST(request: Request) {
  const session = await getServerSession();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const userId = (session.user as { id: string }).id;
  const body = (await request.json()) as { url?: string };

  if (!body.url || typeof body.url !== 'string') {
    return NextResponse.json(
      { error: 'Missing required field: url' },
      { status: 400 }
    );
  }

  if (!YOUTUBE_URL_REGEX.test(body.url)) {
    return NextResponse.json(
      { error: 'Invalid YouTube URL. Must be a youtube.com or youtu.be link.' },
      { status: 400 }
    );
  }

  const video = await prisma.video.create({
    data: {
      userId,
      sourceUrl: body.url,
      status: VideoStatus.PENDING,
    },
  });

  await videoQueue.add(JobType.DOWNLOAD, {
    type: JobType.DOWNLOAD,
    videoId: video.id,
    userId,
    sourceUrl: body.url,
  });

  return NextResponse.json(
    { id: video.id, status: video.status },
    { status: 201 }
  );
}

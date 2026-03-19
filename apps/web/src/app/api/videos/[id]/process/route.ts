import { NextResponse } from 'next/server';
import { getServerSession } from '@/lib/auth';
import { prisma } from '@clipflow/db';
import { JobType } from '@clipflow/shared';
import { videoQueue } from '@/lib/queue';

interface ProcessBody {
  startTime?: number;
  endTime?: number;
  captions?: boolean;
  captionStyle?: string;
}

export async function POST(
  request: Request,
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

  const body = (await request.json()) as ProcessBody;

  await videoQueue.add(JobType.PROCESS, {
    type: JobType.PROCESS,
    videoId: video.id,
    userId,
    options: {
      startTime: body.startTime,
      endTime: body.endTime,
      captions: body.captions,
      captionStyle: body.captionStyle,
    },
  });

  if (body.captions) {
    await videoQueue.add(JobType.TRANSCRIBE, {
      type: JobType.TRANSCRIBE,
      videoId: video.id,
      userId,
    });
  }

  const updatedVideo = await prisma.video.update({
    where: { id: video.id },
    data: { status: 'PROCESSING' },
  });

  return NextResponse.json(updatedVideo);
}

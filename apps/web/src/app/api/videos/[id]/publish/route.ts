import { NextResponse } from 'next/server';
import { getServerSession } from '@/lib/auth';
import { prisma } from '@clipflow/db';
import { JobType, Platform, PostStatus, VideoStatus } from '@clipflow/shared';
import { videoQueue } from '@/lib/queue';

interface PublishBody {
  platform?: string;
  caption?: string;
  hashtags?: string[];
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

  if (video.status !== VideoStatus.READY) {
    return NextResponse.json(
      { error: 'Video is not ready for publishing' },
      { status: 400 }
    );
  }

  const body = (await request.json()) as PublishBody;

  if (!body.platform || !Object.values(Platform).includes(body.platform as Platform)) {
    return NextResponse.json(
      { error: 'Invalid or missing platform' },
      { status: 400 }
    );
  }

  const post = await prisma.post.create({
    data: {
      videoId: video.id,
      platform: body.platform as Platform,
      caption: body.caption ?? null,
      hashtags: body.hashtags ?? [],
      status: PostStatus.UPLOADING,
    },
  });

  await videoQueue.add(JobType.UPLOAD, {
    type: JobType.UPLOAD,
    videoId: video.id,
    userId,
    options: {
      postId: post.id,
      platform: body.platform,
      caption: body.caption,
      hashtags: body.hashtags,
    },
  });

  return NextResponse.json(post, { status: 201 });
}

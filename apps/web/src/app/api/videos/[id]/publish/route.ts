import { NextResponse } from 'next/server';
import { getServerSession } from '@/lib/auth';
import { prisma } from '@clipflow/db';
import { JobType, Platform, PostStatus, VideoStatus } from '@clipflow/shared';
import { videoQueue } from '@/lib/queue';

interface PublishBody {
  platform?: string;
  caption?: string;
  hashtags?: string[];
  visibility?: string;
  scheduledAt?: string;
  postMode?: 'inbox' | 'direct';
  disableComment?: boolean;
  disableDuet?: boolean;
  disableStitch?: boolean;
  // TikTok Direct Post: the privacy level the user explicitly selected from the
  // options creator_info/query returned, plus commercial-content disclosure.
  privacyLevel?: string;
  brandOrganic?: boolean;
  brandedContent?: boolean;
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

  // TikTok Direct Post compliance: privacy must be explicitly chosen, and
  // branded content can never be posted privately.
  if (body.platform === Platform.TIKTOK && body.postMode === 'direct') {
    if (!body.privacyLevel) {
      return NextResponse.json(
        { error: 'A privacy level must be selected for a Direct Post' },
        { status: 400 }
      );
    }
    if (body.brandedContent && body.privacyLevel === 'SELF_ONLY') {
      return NextResponse.json(
        { error: 'Branded content cannot be posted with "Only me" visibility' },
        { status: 400 }
      );
    }
  }

  // Determine if this is a scheduled post or an immediate publish
  const isScheduled = !!body.scheduledAt;
  let scheduledAt: Date | null = null;

  if (isScheduled) {
    scheduledAt = new Date(body.scheduledAt!);
    if (isNaN(scheduledAt.getTime())) {
      return NextResponse.json(
        { error: 'Invalid scheduledAt date' },
        { status: 400 }
      );
    }
    if (scheduledAt <= new Date()) {
      return NextResponse.json(
        { error: 'scheduledAt must be in the future' },
        { status: 400 }
      );
    }
  }

  // Reuse existing FAILED post for retries instead of creating duplicates
  const existingPost = await prisma.post.findFirst({
    where: {
      videoId: video.id,
      platform: body.platform as Platform,
      status: PostStatus.FAILED,
    },
  });

  const post = existingPost
    ? await prisma.post.update({
        where: { id: existingPost.id },
        data: {
          caption: body.caption ?? null,
          hashtags: body.hashtags ?? [],
          status: isScheduled ? PostStatus.SCHEDULED : PostStatus.UPLOADING,
          scheduledAt,
        },
      })
    : await prisma.post.create({
        data: {
          videoId: video.id,
          platform: body.platform as Platform,
          caption: body.caption ?? null,
          hashtags: body.hashtags ?? [],
          status: isScheduled ? PostStatus.SCHEDULED : PostStatus.UPLOADING,
          scheduledAt,
        },
      });

  // Only enqueue immediate upload if not scheduled
  if (!isScheduled) {
    await videoQueue.add(JobType.UPLOAD, {
      type: JobType.UPLOAD,
      videoId: video.id,
      userId,
      options: {
        postId: post.id,
        platform: body.platform,
        caption: body.caption,
        hashtags: body.hashtags,
        visibility: body.visibility,
        postMode: body.postMode ?? 'inbox',
        disableComment: body.disableComment,
        disableDuet: body.disableDuet,
        disableStitch: body.disableStitch,
        privacyLevel: body.privacyLevel,
        brandOrganic: body.brandOrganic,
        brandedContent: body.brandedContent,
      },
    });
  }

  return NextResponse.json(post, { status: 201 });
}

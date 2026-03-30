import { NextResponse } from 'next/server';
import { getServerSession } from '@/lib/auth';
import { prisma } from '@clipflow/db';
import { Platform, PostStatus } from '@clipflow/shared';

interface UpdatePostBody {
  caption?: string;
  hashtags?: string[];
  scheduledAt?: string;
  platform?: string;
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

  const post = await prisma.post.findFirst({
    where: {
      id,
      migrationId: null,
      video: { userId },
    },
    include: {
      video: {
        select: {
          id: true,
          title: true,
          thumbnailUrl: true,
          status: true,
        },
      },
    },
  });

  if (!post) {
    return NextResponse.json({ error: 'Post not found' }, { status: 404 });
  }

  return NextResponse.json(post);
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const userId = (session.user as { id: string }).id;
  const { id } = await params;

  const post = await prisma.post.findFirst({
    where: {
      id,
      migrationId: null,
      video: { userId },
    },
  });

  if (!post) {
    return NextResponse.json({ error: 'Post not found' }, { status: 404 });
  }

  if (post.status !== PostStatus.SCHEDULED && post.status !== PostStatus.DRAFT) {
    return NextResponse.json(
      { error: 'Only scheduled or draft posts can be edited' },
      { status: 400 }
    );
  }

  const body = (await request.json()) as UpdatePostBody;
  const updateData: Record<string, unknown> = {};

  if (body.caption !== undefined) {
    updateData.caption = body.caption;
  }

  if (body.hashtags !== undefined) {
    updateData.hashtags = body.hashtags;
  }

  if (body.scheduledAt !== undefined) {
    const scheduledDate = new Date(body.scheduledAt);
    if (isNaN(scheduledDate.getTime())) {
      return NextResponse.json(
        { error: 'Invalid scheduledAt date' },
        { status: 400 }
      );
    }
    updateData.scheduledAt = scheduledDate;
  }

  if (body.platform !== undefined) {
    if (!Object.values(Platform).includes(body.platform as Platform)) {
      return NextResponse.json(
        { error: 'Invalid platform' },
        { status: 400 }
      );
    }
    updateData.platform = body.platform;
  }

  if (Object.keys(updateData).length === 0) {
    return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
  }

  const updated = await prisma.post.update({
    where: { id },
    data: updateData,
    include: {
      video: {
        select: { id: true, title: true, thumbnailUrl: true, status: true },
      },
    },
  });

  return NextResponse.json(updated);
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const userId = (session.user as { id: string }).id;
  const { id } = await params;

  const post = await prisma.post.findFirst({
    where: {
      id,
      migrationId: null,
      video: { userId },
    },
  });

  if (!post) {
    return NextResponse.json({ error: 'Post not found' }, { status: 404 });
  }

  if (
    post.status !== PostStatus.SCHEDULED &&
    post.status !== PostStatus.DRAFT
  ) {
    return NextResponse.json(
      { error: 'Only scheduled or draft posts can be deleted' },
      { status: 400 }
    );
  }

  await prisma.post.delete({ where: { id } });

  return NextResponse.json({ success: true });
}

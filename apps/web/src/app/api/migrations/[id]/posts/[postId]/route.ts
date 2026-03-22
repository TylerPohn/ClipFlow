import { NextResponse } from 'next/server';
import { getServerSession } from '@/lib/auth';
import { prisma } from '@clipflow/db';
import { PostStatus } from '@clipflow/shared';

interface UpdatePostBody {
  caption?: string;
  hashtags?: string[];
  scheduledAt?: string;
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; postId: string }> }
) {
  const session = await getServerSession();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const userId = (session.user as { id: string }).id;
  const { id, postId } = await params;

  // Verify the migration belongs to the user
  const migration = await prisma.migration.findFirst({
    where: { id, userId },
  });

  if (!migration) {
    return NextResponse.json({ error: 'Migration not found' }, { status: 404 });
  }

  // Find the post and verify it belongs to this migration
  const post = await prisma.post.findFirst({
    where: {
      id: postId,
      migrationId: id,
    },
  });

  if (!post) {
    return NextResponse.json({ error: 'Post not found' }, { status: 404 });
  }

  if (post.status !== PostStatus.SCHEDULED) {
    return NextResponse.json(
      { error: 'Only scheduled posts can be edited' },
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
      return NextResponse.json({ error: 'Invalid scheduledAt date' }, { status: 400 });
    }
    updateData.scheduledAt = scheduledDate;
  }

  if (Object.keys(updateData).length === 0) {
    return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
  }

  const updated = await prisma.post.update({
    where: { id: postId },
    data: updateData,
    include: {
      video: {
        select: { id: true, title: true, thumbnailUrl: true },
      },
    },
  });

  return NextResponse.json(updated);
}

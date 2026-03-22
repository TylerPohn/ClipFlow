import { NextResponse } from 'next/server';
import { getServerSession } from '@/lib/auth';
import { prisma } from '@clipflow/db';
import { MigrationStatus, PostStatus } from '@clipflow/shared';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const userId = (session.user as { id: string }).id;
  const { id } = await params;

  const migration = await prisma.migration.findFirst({
    where: { id, userId },
    include: {
      posts: {
        include: {
          video: {
            select: { id: true, title: true, thumbnailUrl: true },
          },
        },
        orderBy: { scheduledAt: 'asc' },
      },
    },
  });

  if (!migration) {
    return NextResponse.json({ error: 'Migration not found' }, { status: 404 });
  }

  return NextResponse.json(migration);
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

  const migration = await prisma.migration.findFirst({
    where: { id, userId },
  });

  if (!migration) {
    return NextResponse.json({ error: 'Migration not found' }, { status: 404 });
  }

  const body = (await request.json()) as { status: string };

  if (!body.status || !Object.values(MigrationStatus).includes(body.status as MigrationStatus)) {
    return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
  }

  const newStatus = body.status as MigrationStatus;

  // Validate status transitions
  if (migration.status === MigrationStatus.CANCELLED) {
    return NextResponse.json({ error: 'Cannot update a cancelled migration' }, { status: 400 });
  }

  if (migration.status === MigrationStatus.COMPLETED) {
    return NextResponse.json({ error: 'Cannot update a completed migration' }, { status: 400 });
  }

  if (newStatus === MigrationStatus.CANCELLED) {
    // Cancel: update migration status and set all SCHEDULED posts to DRAFT
    const updated = await prisma.$transaction(async (tx) => {
      await tx.post.updateMany({
        where: {
          migrationId: id,
          status: PostStatus.SCHEDULED,
        },
        data: { status: PostStatus.DRAFT },
      });

      return tx.migration.update({
        where: { id },
        data: { status: MigrationStatus.CANCELLED },
      });
    });

    return NextResponse.json(updated);
  }

  if (newStatus === MigrationStatus.PAUSED && migration.status === MigrationStatus.ACTIVE) {
    const updated = await prisma.migration.update({
      where: { id },
      data: { status: MigrationStatus.PAUSED },
    });
    return NextResponse.json(updated);
  }

  if (newStatus === MigrationStatus.ACTIVE && migration.status === MigrationStatus.PAUSED) {
    const updated = await prisma.migration.update({
      where: { id },
      data: { status: MigrationStatus.ACTIVE },
    });
    return NextResponse.json(updated);
  }

  return NextResponse.json({ error: 'Invalid status transition' }, { status: 400 });
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const userId = (session.user as { id: string }).id;
  const { id } = await params;

  const migration = await prisma.migration.findFirst({
    where: { id, userId },
  });

  if (!migration) {
    return NextResponse.json({ error: 'Migration not found' }, { status: 404 });
  }

  await prisma.$transaction(async (tx) => {
    await tx.post.updateMany({
      where: {
        migrationId: id,
        status: PostStatus.SCHEDULED,
      },
      data: { status: PostStatus.DRAFT },
    });

    await tx.migration.update({
      where: { id },
      data: { status: MigrationStatus.CANCELLED },
    });
  });

  return NextResponse.json({ success: true });
}

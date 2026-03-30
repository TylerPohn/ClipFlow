import { NextResponse } from 'next/server';
import { getServerSession } from '@/lib/auth';
import { prisma } from '@clipflow/db';

export async function GET() {
  const session = await getServerSession();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const userId = (session.user as { id: string }).id;

  const posts = await prisma.post.findMany({
    where: {
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
    orderBy: { scheduledAt: 'asc' },
  });

  return NextResponse.json(posts);
}

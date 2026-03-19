import { NextResponse } from 'next/server';
import { getServerSession } from '@/lib/auth';
import { prisma } from '@clipflow/db';

export async function GET() {
  const session = await getServerSession();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const userId = (session.user as { id: string }).id;

  const videos = await prisma.video.findMany({
    where: { userId },
    include: { posts: true },
    orderBy: { createdAt: 'desc' },
  });

  return NextResponse.json(videos);
}

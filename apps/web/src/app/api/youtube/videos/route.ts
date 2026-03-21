import { NextResponse } from 'next/server';
import { getServerSession } from '@/lib/auth';
import { prisma } from '@clipflow/db';

export async function GET(request: Request) {
  const session = await getServerSession();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const userId = (session.user as { id: string }).id;
  const { searchParams } = new URL(request.url);
  const page = parseInt(searchParams.get('page') ?? '1', 10);
  const limit = Math.min(parseInt(searchParams.get('limit') ?? '50', 10), 50);
  const skip = (page - 1) * limit;

  // Get videos imported from YouTube (sourceUrl contains youtube.com or youtu.be)
  const [videos, total] = await Promise.all([
    prisma.video.findMany({
      where: {
        userId,
        OR: [
          { sourceUrl: { contains: 'youtube.com' } },
          { sourceUrl: { contains: 'youtu.be' } },
        ],
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
      include: { posts: true },
    }),
    prisma.video.count({
      where: {
        userId,
        OR: [
          { sourceUrl: { contains: 'youtube.com' } },
          { sourceUrl: { contains: 'youtu.be' } },
        ],
      },
    }),
  ]);

  return NextResponse.json({ videos, total, page, limit });
}

import { NextResponse } from 'next/server';
import { getServerSession } from '@/lib/auth';
import { prisma } from '@clipflow/db';
import { Platform } from '@clipflow/shared';

const VALID_PLATFORMS = new Set(Object.values(Platform));

export async function POST(
  request: Request,
  { params }: { params: Promise<{ platform: string }> }
) {
  const session = await getServerSession();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const userId = (session.user as { id: string }).id;
  const { platform } = await params;
  const upperPlatform = platform.toUpperCase();

  if (!VALID_PLATFORMS.has(upperPlatform as Platform)) {
    return NextResponse.json({ error: 'Invalid platform' }, { status: 400 });
  }

  await prisma.platformAccount.deleteMany({
    where: { userId, platform: upperPlatform as Platform },
  });

  return NextResponse.json({ success: true });
}

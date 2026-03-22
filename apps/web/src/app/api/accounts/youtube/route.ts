import { NextResponse } from 'next/server';
import { getServerSession } from '@/lib/auth';
import { prisma } from '@clipflow/db';

export async function GET() {
  const session = await getServerSession();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const userId = (session.user as { id: string }).id;

  const platformAccount = await prisma.platformAccount.findFirst({
    where: { userId, platform: 'YOUTUBE' },
    select: {
      id: true,
      platformUserId: true,
      displayName: true,
      handle: true,
      avatarUrl: true,
      lastSyncedAt: true,
    },
  });

  // Return same shape as before for frontend compatibility
  const channel = platformAccount
    ? {
        id: platformAccount.id,
        channelId: platformAccount.platformUserId,
        channelName: platformAccount.displayName,
        channelHandle: platformAccount.handle,
        thumbnailUrl: platformAccount.avatarUrl,
        lastSyncedAt: platformAccount.lastSyncedAt,
      }
    : null;

  return NextResponse.json({
    connected: !!channel,
    channel,
  });
}

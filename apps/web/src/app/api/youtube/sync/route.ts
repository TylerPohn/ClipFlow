import { NextResponse } from 'next/server';
import { getServerSession } from '@/lib/auth';
import { prisma } from '@clipflow/db';
import { videoQueue } from '@/lib/queue';
import { JobType } from '@clipflow/shared';

export async function POST() {
  const session = await getServerSession();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const userId = (session.user as { id: string }).id;

  const platformAccount = await prisma.platformAccount.findFirst({
    where: { userId, platform: 'YOUTUBE' },
  });

  if (!platformAccount) {
    return NextResponse.json({ error: 'No YouTube channel linked' }, { status: 400 });
  }

  const channelId = platformAccount.platformUserId;

  await videoQueue.add(`youtube-sync-${channelId}`, {
    type: JobType.YOUTUBE_SYNC,
    videoId: '',
    userId,
    options: { channelId, platformAccountId: platformAccount.id },
  });

  return NextResponse.json({ status: 'sync_queued', channelId });
}

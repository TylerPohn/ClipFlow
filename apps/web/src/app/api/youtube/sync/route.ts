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

  const channel = await prisma.youTubeChannel.findFirst({
    where: { userId },
  });

  if (!channel) {
    return NextResponse.json({ error: 'No YouTube channel linked' }, { status: 400 });
  }

  await videoQueue.add(`youtube-sync-${channel.channelId}`, {
    type: JobType.YOUTUBE_SYNC,
    videoId: '',
    userId,
    options: { channelId: channel.channelId },
  });

  return NextResponse.json({ status: 'sync_queued', channelId: channel.channelId });
}

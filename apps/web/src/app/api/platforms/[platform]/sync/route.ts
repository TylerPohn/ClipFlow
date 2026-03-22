import { NextResponse } from 'next/server';
import { getServerSession } from '@/lib/auth';
import { prisma } from '@clipflow/db';
import { videoQueue } from '@/lib/queue';
import { JobType } from '@clipflow/shared';

const SYNC_PLATFORMS = ['YOUTUBE'];

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ platform: string }> }
) {
  const session = await getServerSession();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const userId = (session.user as { id: string }).id;
  const { platform: rawPlatform } = await params;
  const platform = rawPlatform.toUpperCase();

  if (!SYNC_PLATFORMS.includes(platform)) {
    return NextResponse.json(
      { error: 'Sync not supported for this platform' },
      { status: 400 }
    );
  }

  const platformAccount = await prisma.platformAccount.findFirst({
    where: { userId, platform: platform as 'YOUTUBE' | 'TIKTOK' | 'INSTAGRAM' | 'YOUTUBE_SHORTS' | 'X' },
  });

  if (!platformAccount) {
    return NextResponse.json(
      { error: `No ${platform} account linked` },
      { status: 400 }
    );
  }

  if (platform === 'YOUTUBE') {
    const channelId = platformAccount.platformUserId;

    await videoQueue.add(`youtube-sync-${channelId}`, {
      type: JobType.YOUTUBE_SYNC,
      videoId: '',
      userId,
      options: { channelId, platformAccountId: platformAccount.id },
    });

    return NextResponse.json({ status: 'sync_queued', channelId });
  }

  // Future platforms with sync support would go here
  return NextResponse.json(
    { error: 'Sync not supported for this platform' },
    { status: 400 }
  );
}

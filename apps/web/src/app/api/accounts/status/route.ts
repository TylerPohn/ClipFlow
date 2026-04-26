import { NextResponse } from 'next/server';
import { getServerSession } from '@/lib/auth';
import { prisma } from '@clipflow/db';

const ALL_PLATFORMS = ['YOUTUBE', 'TIKTOK', 'INSTAGRAM', 'X'] as const;

export async function GET() {
  const session = await getServerSession();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const userId = (session.user as { id: string }).id;

  const platformAccounts = await prisma.platformAccount.findMany({
    where: { userId, platform: { in: [...ALL_PLATFORMS] } },
    select: {
      platform: true,
      displayName: true,
      handle: true,
      avatarUrl: true,
      lastSyncedAt: true,
      tokenStatus: true,
      bio: true,
      isVerified: true,
      profileWebLink: true,
      profileDeepLink: true,
      followerCount: true,
      followingCount: true,
      likesCount: true,
      videoCount: true,
      statsUpdatedAt: true,
    },
  });

  const accountsByPlatform = new Map(
    platformAccounts.map((a) => [a.platform, a])
  );

  const accounts: Record<string, unknown> = {};
  for (const platform of ALL_PLATFORMS) {
    const account = accountsByPlatform.get(platform);
    if (account) {
      accounts[platform] = {
        connected: true,
        displayName: account.displayName,
        handle: account.handle,
        avatarUrl: account.avatarUrl,
        lastSyncedAt: account.lastSyncedAt,
        tokenStatus: account.tokenStatus,
        bio: account.bio,
        isVerified: account.isVerified,
        profileWebLink: account.profileWebLink,
        profileDeepLink: account.profileDeepLink,
        followerCount: account.followerCount,
        followingCount: account.followingCount,
        likesCount: account.likesCount,
        videoCount: account.videoCount,
        statsUpdatedAt: account.statsUpdatedAt,
      };
    } else {
      accounts[platform] = { connected: false };
    }
  }

  return NextResponse.json({ accounts });
}

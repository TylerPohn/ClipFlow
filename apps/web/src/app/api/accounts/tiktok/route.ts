import { NextResponse } from 'next/server';
import { getServerSession } from '@/lib/auth';
import { prisma } from '@clipflow/db';

export async function GET() {
  const session = await getServerSession();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const userId = (session.user as { id: string }).id;

  const account = await prisma.platformAccount.findFirst({
    where: { userId, platform: 'TIKTOK' },
    select: {
      id: true,
      platformUserId: true,
      displayName: true,
      handle: true,
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

  return NextResponse.json({
    connected: !!account,
    accountId: account?.platformUserId ?? null,
    displayName: account?.displayName ?? null,
    handle: account?.handle ?? null,
    tokenStatus: account?.tokenStatus ?? null,
    bio: account?.bio ?? null,
    isVerified: account?.isVerified ?? false,
    profileWebLink: account?.profileWebLink ?? null,
    profileDeepLink: account?.profileDeepLink ?? null,
    followerCount: account?.followerCount ?? null,
    followingCount: account?.followingCount ?? null,
    likesCount: account?.likesCount ?? null,
    videoCount: account?.videoCount ?? null,
    statsUpdatedAt: account?.statsUpdatedAt ?? null,
  });
}

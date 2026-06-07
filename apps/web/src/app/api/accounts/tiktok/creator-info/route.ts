import { NextResponse } from 'next/server';
import { getServerSession } from '@/lib/auth';
import { prisma } from '@clipflow/db';
import { queryCreatorInfo } from '@clipflow/video-processing';
import { ensureFreshTikTokToken } from '@/lib/tiktok-token';

/**
 * Returns live creator posting capabilities from TikTok's creator_info/query
 * endpoint. The Direct Post composer calls this before rendering so the privacy
 * selector, interaction toggles, and duration limit come from the API (a TikTok
 * audit requirement) rather than being hardcoded.
 */
export async function GET() {
  const session = await getServerSession();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const userId = (session.user as { id: string }).id;

  const account = await prisma.platformAccount.findFirst({
    where: { userId, platform: 'TIKTOK' },
    select: { id: true },
  });

  if (!account) {
    return NextResponse.json(
      { error: 'No TikTok account linked' },
      { status: 404 }
    );
  }

  try {
    const accessToken = await ensureFreshTikTokToken(account.id);
    const creatorInfo = await queryCreatorInfo(accessToken);
    return NextResponse.json(creatorInfo);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to load TikTok creator info';
    console.error('creator_info/query failed:', message);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

import { NextResponse } from 'next/server';
import { getServerSession } from '@/lib/auth';
import { prisma } from '@clipflow/db';
import { deleteFile, Platform, S3_BUCKETS } from '@clipflow/shared';

const VALID_PLATFORMS = new Set(Object.values(Platform));

export async function POST(
  request: Request,
  { params }: { params: Promise<{ platform: string }> },
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

  if (upperPlatform === Platform.YOUTUBE) {
    const [platformAccounts, oauthAccounts, syncedVideos] = await Promise.all([
      prisma.platformAccount.findMany({
        where: { userId, platform: Platform.YOUTUBE },
        select: { accessToken: true, refreshToken: true },
      }),
      prisma.account.findMany({
        where: { userId, provider: 'google-youtube' },
        select: { access_token: true, refresh_token: true },
      }),
      prisma.video.findMany({
        where: { userId, platform: Platform.YOUTUBE },
        select: { id: true, rawStorageKey: true, processedStorageKey: true },
      }),
    ]);

    // Revoke the Google grant before deleting the local credentials. Revocation
    // is best-effort so users can still disconnect if Google is unavailable.
    const tokens = new Set<string>();
    for (const account of platformAccounts) {
      if (account.refreshToken) tokens.add(account.refreshToken);
      else if (account.accessToken) tokens.add(account.accessToken);
    }
    for (const account of oauthAccounts) {
      if (account.refresh_token) tokens.add(account.refresh_token);
      else if (account.access_token) tokens.add(account.access_token);
    }
    const revocations = await Promise.allSettled(
      [...tokens].map((token) =>
        fetch('https://oauth2.googleapis.com/revoke', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ token }),
        }),
      ),
    );
    for (const result of revocations) {
      if (result.status === 'rejected' || !result.value.ok) {
        console.error(
          'Unable to revoke a Google OAuth token during disconnect',
        );
      }
    }

    // Remove stored media derived from synchronized YouTube records. A failed
    // object deletion is logged but does not trap the user in a connected state.
    const objectDeletes: Promise<void>[] = [];
    for (const video of syncedVideos) {
      if (video.rawStorageKey) {
        objectDeletes.push(deleteFile(S3_BUCKETS.RAW, video.rawStorageKey));
      }
      if (video.processedStorageKey) {
        objectDeletes.push(
          deleteFile(S3_BUCKETS.PROCESSED, video.processedStorageKey),
        );
      }
    }
    const deletedObjects = await Promise.allSettled(objectDeletes);
    for (const result of deletedObjects) {
      if (result.status === 'rejected') {
        console.error('Unable to delete a stored YouTube-derived media object');
      }
    }

    const videoIds = syncedVideos.map((video) => video.id);
    await prisma.$transaction([
      ...(videoIds.length
        ? [prisma.post.deleteMany({ where: { videoId: { in: videoIds } } })]
        : []),
      prisma.video.deleteMany({
        where: { userId, platform: Platform.YOUTUBE },
      }),
      prisma.youTubeChannel.deleteMany({ where: { userId } }),
      prisma.account.deleteMany({
        where: { userId, provider: 'google-youtube' },
      }),
      prisma.platformAccount.deleteMany({
        where: { userId, platform: Platform.YOUTUBE },
      }),
    ]);

    return NextResponse.json({ success: true });
  }

  await prisma.platformAccount.deleteMany({
    where: { userId, platform: upperPlatform as Platform },
  });

  return NextResponse.json({ success: true });
}

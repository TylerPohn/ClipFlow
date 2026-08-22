import { prisma } from '@clipflow/db';
import { deleteFile, Platform, S3_BUCKETS } from '@clipflow/shared';

export async function deleteInstagramUserData(
  instagramUserId: string,
): Promise<void> {
  const platformAccounts = await prisma.platformAccount.findMany({
    where: {
      platform: Platform.INSTAGRAM,
      platformUserId: instagramUserId,
    },
    select: { userId: true },
  });
  const userIds = [
    ...new Set(platformAccounts.map((account) => account.userId)),
  ];

  const videos = userIds.length
    ? await prisma.video.findMany({
        where: {
          userId: { in: userIds },
          platform: Platform.INSTAGRAM,
        },
        select: {
          id: true,
          rawStorageKey: true,
          processedStorageKey: true,
        },
      })
    : [];

  const objectDeletes: Promise<void>[] = [];
  for (const video of videos) {
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
      console.error('Unable to delete an Instagram-derived media object');
    }
  }

  await prisma.$transaction([
    prisma.account.deleteMany({
      where: {
        provider: 'instagram',
        providerAccountId: instagramUserId,
      },
    }),
    ...(videos.length
      ? [
          prisma.video.deleteMany({
            where: { id: { in: videos.map((video) => video.id) } },
          }),
        ]
      : []),
    prisma.platformAccount.deleteMany({
      where: {
        platform: Platform.INSTAGRAM,
        platformUserId: instagramUserId,
      },
    }),
  ]);
}

import { Job } from 'bullmq';
import type { VideoJob } from '@clipflow/shared';
import { prisma } from '@clipflow/db';
import { handleYouTubeSync } from './youtube-sync';

export async function handlePlatformSync(job: Job<VideoJob>) {
  const { platformAccountId, specificVideoId } = job.data as any;
  const account = await prisma.platformAccount.findUniqueOrThrow({
    where: { id: platformAccountId },
  });

  switch (account.platform) {
    case 'YOUTUBE':
      // Delegate to existing YouTube sync with adapted params
      await handleYouTubeSync({
        ...job,
        data: {
          ...job.data,
          userId: account.userId,
          options: {
            channelId: account.platformUserId,
            specificVideoId,
          },
        },
      } as Job<VideoJob>);
      break;
    default:
      console.log(`Sync not yet implemented for platform: ${account.platform}`);
  }
}

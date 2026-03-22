import type { Job } from 'bullmq';
import { Queue } from 'bullmq';
import {
  type VideoJob,
  JobType,
  PostStatus,
  MigrationStatus,
  QUEUE_NAME,
  VideoStatus,
} from '@clipflow/shared';
import { prisma } from '@clipflow/db';

const MAX_RETRIES = 3;

export async function handleScheduleCheck(job: Job<VideoJob>): Promise<void> {
  console.log('Running schedule check...');

  // Find all posts that are due for publishing
  const duePosts = await prisma.post.findMany({
    where: {
      status: PostStatus.SCHEDULED,
      scheduledAt: { lte: new Date() },
      migration: {
        status: MigrationStatus.ACTIVE,
      },
    },
    include: {
      video: true,
      migration: true,
    },
  });

  if (duePosts.length === 0) {
    console.log('No scheduled posts due.');
    return;
  }

  console.log(`Found ${duePosts.length} scheduled posts due for publishing.`);

  const redisUrl = new URL(
    process.env.REDIS_URL ?? 'redis://localhost:6379'
  );
  const connection = {
    host: redisUrl.hostname,
    port: Number(redisUrl.port) || 6379,
  };
  const queue = new Queue(QUEUE_NAME, { connection });

  try {
    for (const post of duePosts) {
      // Skip if video isn't ready yet
      if (post.video.status !== VideoStatus.READY) {
        console.log(
          `Skipping post ${post.id} — video ${post.video.id} status is ${post.video.status}`
        );

        // Track retry count via metadata on the migration's defaultSettings
        const retryKey = `retry_${post.id}`;
        const retries =
          ((post.migration?.defaultSettings as Record<string, unknown>)?.[
            retryKey
          ] as number) ?? 0;

        if (retries >= MAX_RETRIES) {
          console.log(
            `Post ${post.id} exceeded max retries (${MAX_RETRIES}), marking FAILED`
          );
          await prisma.post.update({
            where: { id: post.id },
            data: { status: PostStatus.FAILED },
          });
        }
        continue;
      }

      // Skip if no processed file
      if (!post.video.processedStorageKey) {
        console.log(
          `Skipping post ${post.id} — video ${post.video.id} has no processed file`
        );
        continue;
      }

      // Verify platform account exists
      const account = await prisma.platformAccount.findFirst({
        where: {
          userId: post.video.userId,
          platform: post.platform,
        },
      });

      if (!account) {
        console.log(
          `Skipping post ${post.id} — no ${post.platform} account linked`
        );
        await prisma.post.update({
          where: { id: post.id },
          data: { status: PostStatus.FAILED },
        });
        continue;
      }

      // Set status to UPLOADING and enqueue upload job
      await prisma.post.update({
        where: { id: post.id },
        data: { status: PostStatus.UPLOADING },
      });

      await queue.add(JobType.UPLOAD, {
        type: JobType.UPLOAD,
        videoId: post.video.id,
        userId: post.video.userId,
        options: {
          postId: post.id,
          platform: post.platform,
          caption: post.caption,
          hashtags: post.hashtags,
        },
      });

      console.log(
        `Enqueued upload for post ${post.id} (video ${post.video.id} → ${post.platform})`
      );
    }

    // Check if any active migrations are now complete
    const activeMigrations = await prisma.migration.findMany({
      where: { status: MigrationStatus.ACTIVE },
      include: {
        posts: {
          select: { status: true },
        },
      },
    });

    for (const migration of activeMigrations) {
      const allDone = migration.posts.every(
        (p) =>
          p.status === PostStatus.POSTED || p.status === PostStatus.FAILED
      );
      if (allDone && migration.posts.length > 0) {
        await prisma.migration.update({
          where: { id: migration.id },
          data: { status: MigrationStatus.COMPLETED },
        });
        console.log(`Migration ${migration.id} marked as COMPLETED`);
      }
    }
  } finally {
    await queue.close();
  }
}

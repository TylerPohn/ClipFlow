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

export async function handleScheduleCheck(job: Job<VideoJob>): Promise<void> {
  console.log('Running schedule check...');

  // Find all posts that are due for publishing
  const duePosts = await prisma.post.findMany({
    where: {
      status: PostStatus.SCHEDULED,
      scheduledAt: { lte: new Date() },
      OR: [
        { migration: { status: MigrationStatus.ACTIVE } },
        { migrationId: null },
      ],
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
      // If video is FAILED, mark the post as FAILED too
      if (post.video.status === VideoStatus.FAILED) {
        console.log(
          `Post ${post.id} — video ${post.video.id} is FAILED, marking post FAILED`
        );
        await prisma.post.update({
          where: { id: post.id },
          data: { status: PostStatus.FAILED },
        });
        continue;
      }

      // If video isn't READY, kick off processing and wait for next cycle
      if (post.video.status !== VideoStatus.READY || !post.video.processedStorageKey) {
        // Only enqueue processing if the video is in a state that needs it
        // (PENDING = needs download+process, DOWNLOADING/PROCESSING = already in progress)
        if (post.video.status === VideoStatus.PENDING) {
          console.log(
            `Post ${post.id} — video ${post.video.id} is PENDING, enqueuing DOWNLOAD+PROCESS`
          );
          await queue.add(JobType.DOWNLOAD, {
            type: JobType.DOWNLOAD,
            videoId: post.video.id,
            userId: post.video.userId,
            sourceUrl: post.video.sourceUrl,
          });
        } else if (
          post.video.status === VideoStatus.READY &&
          !post.video.processedStorageKey
        ) {
          // Has raw file but no processed file
          console.log(
            `Post ${post.id} — video ${post.video.id} needs processing, enqueuing PROCESS`
          );
          await queue.add(JobType.PROCESS, {
            type: JobType.PROCESS,
            videoId: post.video.id,
            userId: post.video.userId,
          });
        } else {
          console.log(
            `Post ${post.id} — video ${post.video.id} status is ${post.video.status}, waiting for next cycle`
          );
        }
        // Leave post as SCHEDULED — will pick it up next cycle when video is READY
        continue;
      }

      // Verify platform account exists. YOUTUBE_SHORTS posts through the
      // linked YOUTUBE account — it has no OAuth flow of its own.
      const accountPlatform =
        post.platform === 'YOUTUBE_SHORTS' ? 'YOUTUBE' : post.platform;

      const account = await prisma.platformAccount.findFirst({
        where: {
          userId: post.video.userId,
          platform: accountPlatform,
        },
      });

      if (!account) {
        console.log(
          `Skipping post ${post.id} — no ${accountPlatform} account linked`
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
    // (only relevant for migration-based posts, not standalone)
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

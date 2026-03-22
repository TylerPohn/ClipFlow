import 'dotenv/config';
import { Worker, Queue } from 'bullmq';
import { QUEUE_NAME, JobType, type VideoJob } from '@clipflow/shared';
import { handleDownload } from './handlers/download';
import { handleProcess } from './handlers/process';
import { handleTranscribe } from './handlers/transcribe';
import { handleUpload } from './handlers/upload';
import { handleYouTubeSync } from './handlers/youtube-sync';
import { handleYouTubeSubscribe } from './handlers/youtube-subscribe';
import { handlePlatformSync } from './handlers/platform-sync';
import { handlePlatformSubscribe } from './handlers/platform-subscribe';
import { handleScheduleCheck } from './handlers/schedule-check';

const redisUrl = new URL(
  process.env.REDIS_URL ?? 'redis://localhost:6379'
);

const connection = {
  host: redisUrl.hostname,
  port: Number(redisUrl.port) || 6379,
};

const worker = new Worker<VideoJob>(
  QUEUE_NAME,
  async (job) => {
    console.log(`Processing job ${job.id} of type ${job.data.type}`);

    switch (job.data.type) {
      case JobType.DOWNLOAD:
        return handleDownload(job);
      case JobType.PROCESS:
        return handleProcess(job);
      case JobType.TRANSCRIBE:
        return handleTranscribe(job);
      case JobType.UPLOAD:
        return handleUpload(job);
      case JobType.YOUTUBE_SYNC:
        return handleYouTubeSync(job);
      case JobType.YOUTUBE_SUBSCRIBE:
        return handleYouTubeSubscribe(job);
      case JobType.PLATFORM_SYNC:
        return handlePlatformSync(job);
      case JobType.PLATFORM_SUBSCRIBE:
        return handlePlatformSubscribe(job);
      case JobType.SCHEDULE_CHECK:
        return handleScheduleCheck(job);
      default:
        throw new Error(`Unknown job type: ${(job.data as VideoJob).type}`);
    }
  },
  {
    connection,
    concurrency: 2,
  }
);

// Register the SCHEDULE_CHECK repeatable job (every 5 minutes)
async function registerScheduleCheck() {
  const queue = new Queue(QUEUE_NAME, { connection });
  try {
    await queue.upsertJobScheduler(
      'schedule-check',
      { every: 5 * 60 * 1000 },
      {
        name: JobType.SCHEDULE_CHECK,
        data: {
          type: JobType.SCHEDULE_CHECK,
          videoId: '',
          userId: '',
        },
      }
    );
    console.log('Registered SCHEDULE_CHECK repeatable job (every 5 minutes)');
  } finally {
    await queue.close();
  }
}

worker.on('completed', (job) => {
  console.log(`Job ${job?.id} completed successfully`);
});

worker.on('failed', (job, err) => {
  console.error(`Job ${job?.id} failed:`, err.message);
});

worker.on('ready', () => {
  console.log(`Worker listening on queue: ${QUEUE_NAME}`);
  registerScheduleCheck().catch((err) =>
    console.error('Failed to register schedule check:', err)
  );
});

process.on('SIGTERM', async () => {
  console.log('Shutting down worker...');
  await worker.close();
  process.exit(0);
});

import 'dotenv/config';
import { Worker } from 'bullmq';
import { QUEUE_NAME, JobType, type VideoJob } from '@clipflow/shared';
import { handleDownload } from './handlers/download';
import { handleProcess } from './handlers/process';
import { handleTranscribe } from './handlers/transcribe';
import { handleUpload } from './handlers/upload';
import { handleYouTubeSync } from './handlers/youtube-sync';
import { handleYouTubeSubscribe } from './handlers/youtube-subscribe';
import { handlePlatformSync } from './handlers/platform-sync';
import { handlePlatformSubscribe } from './handlers/platform-subscribe';

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
      default:
        throw new Error(`Unknown job type: ${(job.data as VideoJob).type}`);
    }
  },
  {
    connection,
    concurrency: 2,
  }
);

worker.on('completed', (job) => {
  console.log(`Job ${job?.id} completed successfully`);
});

worker.on('failed', (job, err) => {
  console.error(`Job ${job?.id} failed:`, err.message);
});

worker.on('ready', () => {
  console.log(`Worker listening on queue: ${QUEUE_NAME}`);
});

process.on('SIGTERM', async () => {
  console.log('Shutting down worker...');
  await worker.close();
  process.exit(0);
});

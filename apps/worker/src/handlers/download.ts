import type { Job } from 'bullmq';
import { Queue } from 'bullmq';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import { mkdir, rm, readFile } from 'fs/promises';
import {
  type VideoJob,
  VideoStatus,
  JobType,
  S3_BUCKETS,
  QUEUE_NAME,
  uploadFile,
} from '@clipflow/shared';
import { prisma } from '@clipflow/db';
import { downloadVideo } from '@clipflow/video-processing';

const redisUrl = new URL(
  process.env.REDIS_URL ?? 'redis://localhost:6379'
);

const queue = new Queue<VideoJob>(QUEUE_NAME, {
  connection: {
    host: redisUrl.hostname,
    port: Number(redisUrl.port) || 6379,
  },
});

export async function handleDownload(job: Job<VideoJob>): Promise<void> {
  const { videoId, userId, sourceUrl } = job.data;

  if (!sourceUrl) {
    throw new Error('sourceUrl is required for DOWNLOAD jobs');
  }

  const tmpDir = path.join(os.tmpdir(), `clipflow-dl-${crypto.randomUUID()}`);

  try {
    // 1. Update video status to DOWNLOADING
    await prisma.video.update({
      where: { id: videoId },
      data: { status: VideoStatus.DOWNLOADING },
    });

    await job.updateProgress(10);

    // 2. Create temp directory
    await mkdir(tmpDir, { recursive: true });

    // 3. Download via yt-dlp
    const outputPath = path.join(tmpDir, 'raw.mp4');
    const result = await downloadVideo({
      url: sourceUrl,
      outputPath,
    });

    await job.updateProgress(50);

    // 4. Upload raw file to S3
    const rawStorageKey = `${userId}/${videoId}/raw.mp4`;
    const fileBuffer = await readFile(result.filePath);
    await uploadFile(S3_BUCKETS.RAW, rawStorageKey, fileBuffer);

    await job.updateProgress(80);

    // 5. Extract and store metadata in Prisma
    await prisma.video.update({
      where: { id: videoId },
      data: {
        title: result.title,
        duration: result.duration,
        rawStorageKey,
        status: VideoStatus.PENDING,
      },
    });

    await job.updateProgress(90);

    // 6. Auto-enqueue a PROCESS job
    await queue.add(`process-${videoId}`, {
      type: JobType.PROCESS,
      videoId,
      userId,
    });

    console.log(
      `Download complete for video ${videoId}, enqueued PROCESS job`
    );

    await job.updateProgress(100);
  } catch (error) {
    await prisma.video.update({
      where: { id: videoId },
      data: { status: VideoStatus.FAILED },
    });
    throw error;
  } finally {
    // 7. Clean up temp files
    await rm(tmpDir, { recursive: true, force: true });
  }
}

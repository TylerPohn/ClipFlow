import type { Job } from 'bullmq';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import { mkdir, rm } from 'fs/promises';
import {
  type VideoJob,
  VideoStatus,
  S3_BUCKETS,
  uploadFile,
  downloadFile,
  getSignedUrl,
} from '@clipflow/shared';
import { prisma } from '@clipflow/db';
import {
  processVideoVertical,
  generateThumbnail,
} from '@clipflow/video-processing';
import { createReadStream } from 'fs';

export async function handleProcess(job: Job<VideoJob>): Promise<void> {
  const { videoId, userId, options } = job.data;

  const tmpDir = path.join(os.tmpdir(), `clipflow-proc-${crypto.randomUUID()}`);

  try {
    // 1. Update video status to PROCESSING
    await prisma.video.update({
      where: { id: videoId },
      data: { status: VideoStatus.PROCESSING },
    });

    await job.updateProgress(10);

    // 2. Get video record and download raw video from S3
    const video = await prisma.video.findUniqueOrThrow({
      where: { id: videoId },
    });

    if (!video.rawStorageKey) {
      throw new Error(`Video ${videoId} has no rawStorageKey`);
    }

    await mkdir(tmpDir, { recursive: true });

    const rawPath = path.join(tmpDir, 'raw.mp4');
    await downloadFile(S3_BUCKETS.RAW, video.rawStorageKey, rawPath);

    await job.updateProgress(30);

    // 3. Process video: convert to 1080x1920 (9:16 vertical), with optional trim
    const processedPath = path.join(tmpDir, 'processed.mp4');
    const startTime = options?.startTime as number | undefined;
    const endTime = options?.endTime as number | undefined;

    await processVideoVertical({
      inputPath: rawPath,
      outputPath: processedPath,
      width: 1080,
      height: 1920,
      startTime: startTime,
      endTime: endTime,
    });

    await job.updateProgress(60);

    // 4. Generate thumbnail
    const thumbnailPath = path.join(tmpDir, 'thumbnail.jpg');
    await generateThumbnail(rawPath, thumbnailPath);

    await job.updateProgress(70);

    // 5. Upload processed video and thumbnail to S3
    const processedStorageKey = `${userId}/${videoId}/processed.mp4`;
    const thumbnailStorageKey = `${userId}/${videoId}/thumbnail.jpg`;

    await uploadFile(
      S3_BUCKETS.PROCESSED,
      processedStorageKey,
      createReadStream(processedPath)
    );

    await uploadFile(
      S3_BUCKETS.THUMBNAILS,
      thumbnailStorageKey,
      createReadStream(thumbnailPath)
    );

    await job.updateProgress(90);

    // 6. Generate thumbnail URL and update video record
    const thumbnailUrl = await getSignedUrl(
      S3_BUCKETS.THUMBNAILS,
      thumbnailStorageKey,
      60 * 60 * 24 * 7 // 7 days
    );

    await prisma.video.update({
      where: { id: videoId },
      data: {
        processedStorageKey,
        thumbnailUrl,
        status: VideoStatus.READY,
      },
    });

    console.log(`Processing complete for video ${videoId}`);

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

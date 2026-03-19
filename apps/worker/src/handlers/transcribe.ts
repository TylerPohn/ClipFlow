import type { Job } from 'bullmq';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import { mkdir, rm } from 'fs/promises';
import {
  type VideoJob,
  S3_BUCKETS,
  downloadFile,
} from '@clipflow/shared';
import { prisma } from '@clipflow/db';
import { transcribeVideo } from '@clipflow/video-processing';

export async function handleTranscribe(job: Job<VideoJob>): Promise<void> {
  const { videoId } = job.data;

  const tmpDir = path.join(
    os.tmpdir(),
    `clipflow-transcribe-${crypto.randomUUID()}`
  );

  try {
    // 1. Get video record and download processed video from S3
    const video = await prisma.video.findUniqueOrThrow({
      where: { id: videoId },
    });

    if (!video.processedStorageKey) {
      throw new Error(`Video ${videoId} has no processedStorageKey`);
    }

    await mkdir(tmpDir, { recursive: true });

    const videoPath = path.join(tmpDir, 'video.mp4');
    await downloadFile(
      S3_BUCKETS.PROCESSED,
      video.processedStorageKey,
      videoPath
    );

    await job.updateProgress(30);

    // 2. Transcribe via OpenAI Whisper
    const result = await transcribeVideo(videoPath);

    await job.updateProgress(80);

    // 3. Store transcript in Prisma (upsert in case of retry)
    const wordsJson = JSON.parse(JSON.stringify(result.words));

    await prisma.transcript.upsert({
      where: { videoId },
      create: {
        videoId,
        text: result.text,
        words: wordsJson,
      },
      update: {
        text: result.text,
        words: wordsJson,
      },
    });

    console.log(`Transcription complete for video ${videoId}`);

    await job.updateProgress(100);
  } finally {
    // 4. Clean up temp files
    await rm(tmpDir, { recursive: true, force: true });
  }
}

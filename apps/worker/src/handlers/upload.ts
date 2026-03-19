import type { Job } from 'bullmq';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import { mkdir, rm, readFile } from 'fs/promises';
import {
  type VideoJob,
  PostStatus,
  S3_BUCKETS,
  downloadFile,
} from '@clipflow/shared';
import { prisma } from '@clipflow/db';

export async function handleUpload(job: Job<VideoJob>): Promise<void> {
  const { videoId } = job.data;
  const postId = job.data.options?.postId as string | undefined;

  if (!postId) {
    throw new Error('options.postId is required for UPLOAD jobs');
  }

  const tmpDir = path.join(os.tmpdir(), `clipflow-upload-${crypto.randomUUID()}`);

  try {
    // 1. Get post record with video relation
    const post = await prisma.post.findUniqueOrThrow({
      where: { id: postId },
      include: { video: true },
    });

    if (!post.video.processedStorageKey) {
      throw new Error(`Video ${videoId} has no processedStorageKey`);
    }

    // 2. Update post status to UPLOADING
    await prisma.post.update({
      where: { id: postId },
      data: { status: PostStatus.UPLOADING },
    });

    await job.updateProgress(10);

    // 3. Download processed video from S3
    await mkdir(tmpDir, { recursive: true });
    const videoPath = path.join(tmpDir, 'upload.mp4');
    await downloadFile(
      S3_BUCKETS.PROCESSED,
      post.video.processedStorageKey,
      videoPath
    );

    await job.updateProgress(30);

    // 4. Upload to TikTok via Content Posting API
    let platformPostId: string | undefined;

    try {
      // Get TikTok access token from the user's account
      const account = await prisma.account.findFirst({
        where: {
          userId: post.video.userId,
          provider: 'tiktok',
        },
      });

      if (!account?.access_token) {
        throw new Error('No TikTok account linked or access token missing');
      }

      await job.updateProgress(50);

      // Step 1: Initialize upload via TikTok Content Posting API
      const videoBuffer = await readFile(videoPath);

      const initResponse = await fetch(
        'https://open.tiktokapis.com/v2/post/publish/inbox/video/init/',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${account.access_token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            source_info: {
              source: 'FILE_UPLOAD',
              video_size: videoBuffer.byteLength,
              chunk_size: videoBuffer.byteLength,
              total_chunk_count: 1,
            },
          }),
        }
      );

      if (!initResponse.ok) {
        const errorBody = await initResponse.text();
        throw new Error(
          `TikTok init failed (${initResponse.status}): ${errorBody}`
        );
      }

      const initData = (await initResponse.json()) as {
        data: { publish_id: string; upload_url: string };
      };

      await job.updateProgress(70);

      // Step 2: Upload the video chunk
      const uploadResponse = await fetch(initData.data.upload_url, {
        method: 'PUT',
        headers: {
          'Content-Type': 'video/mp4',
          'Content-Range': `bytes 0-${videoBuffer.byteLength - 1}/${videoBuffer.byteLength}`,
        },
        body: videoBuffer,
      });

      if (!uploadResponse.ok) {
        const errorBody = await uploadResponse.text();
        throw new Error(
          `TikTok upload failed (${uploadResponse.status}): ${errorBody}`
        );
      }

      platformPostId = initData.data.publish_id;

      await job.updateProgress(90);
    } catch (uploadError) {
      console.error(
        `Platform upload failed for post ${postId}:`,
        uploadError instanceof Error ? uploadError.message : uploadError
      );

      // 5. Mark as FAILED
      await prisma.post.update({
        where: { id: postId },
        data: { status: PostStatus.FAILED },
      });

      await job.updateProgress(100);
      return;
    }

    // 5. Update post with platformPostId and status POSTED
    await prisma.post.update({
      where: { id: postId },
      data: {
        platformPostId,
        status: PostStatus.POSTED,
        postedAt: new Date(),
      },
    });

    console.log(`Upload complete for post ${postId} (video ${videoId})`);

    await job.updateProgress(100);
  } finally {
    // 6. Clean up temp files
    await rm(tmpDir, { recursive: true, force: true });
  }
}

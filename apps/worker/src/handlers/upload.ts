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
  getSignedUrl,
} from '@clipflow/shared';
import { prisma } from '@clipflow/db';
import {
  directPostToTikTok,
  type DirectPostOptions,
} from '@clipflow/video-processing';
import { uploadToX } from '../uploaders/x';
import { uploadToYouTube } from '../uploaders/youtube';
import { uploadToInstagram } from '../uploaders/instagram';
import { ensureFreshTikTokToken } from '../lib/tiktok-token';

export async function handleUpload(job: Job<VideoJob>): Promise<void> {
  const { videoId } = job.data;
  const postId = job.data.options?.postId as string | undefined;

  if (!postId) {
    throw new Error('options.postId is required for UPLOAD jobs');
  }

  const tmpDir = path.join(
    os.tmpdir(),
    `clipflow-upload-${crypto.randomUUID()}`,
  );

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
      videoPath,
    );

    await job.updateProgress(30);

    // 4. Upload to platform
    let platformPostId: string | undefined;
    let platformPostUrl: string | null = null;
    const platform = post.platform;

    try {
      // YOUTUBE_SHORTS has no OAuth flow of its own — it posts through the
      // linked YOUTUBE account.
      const accountPlatform =
        platform === 'YOUTUBE_SHORTS' ? 'YOUTUBE' : platform;

      const account = await prisma.platformAccount.findFirst({
        where: {
          userId: post.video.userId,
          platform: accountPlatform,
        },
      });

      if (!account?.accessToken) {
        throw new Error(
          `No ${accountPlatform} account linked or access token missing`,
        );
      }

      const caption = job.data.options?.caption as string | undefined;
      const title = job.data.options?.title as string | undefined;
      const requestedDescription = job.data.options?.description as
        | string
        | undefined;
      const hashtags =
        (job.data.options?.hashtags as string[] | undefined) ?? [];
      const visibility =
        (job.data.options?.visibility as string | undefined) ?? 'public';
      const postMode =
        (job.data.options?.postMode as string | undefined) ?? 'inbox';
      const fullCaption = [caption, ...hashtags.map((t) => `#${t}`)]
        .filter(Boolean)
        .join(' ');

      if (platform === 'X') {
        const videoBuffer = await readFile(videoPath);
        platformPostId = await uploadToX(
          account.id,
          videoBuffer,
          fullCaption,
          job,
        );
      } else if (platform === 'TIKTOK') {
        const freshToken = await ensureFreshTikTokToken(account.id);
        if (postMode === 'direct') {
          // The privacy level is the exact enum the user picked from
          // creator_info options; fall back to mapping the generic visibility
          // field only if an older client didn't send it.
          const privacyLevel =
            (job.data.options?.privacyLevel as
              | DirectPostOptions['privacyLevel']
              | undefined) ?? toTikTokDirectPrivacy(visibility);
          const directOptions: DirectPostOptions = {
            title: fullCaption,
            privacyLevel,
            disableComment: job.data.options?.disableComment === true,
            disableDuet: job.data.options?.disableDuet === true,
            disableStitch: job.data.options?.disableStitch === true,
            brandOrganicToggle: job.data.options?.brandOrganic === true,
            brandContentToggle: job.data.options?.brandedContent === true,
          };
          await job.updateProgress(50);
          const result = await directPostToTikTok(
            freshToken,
            videoPath,
            directOptions,
          );
          await job.updateProgress(85);
          platformPostId = result.publishId;
        } else {
          const videoBuffer = await readFile(videoPath);
          platformPostId = await uploadToTikTok(
            { accessToken: freshToken },
            videoBuffer,
            fullCaption,
            visibility,
            job,
          );
        }
      } else if (platform === 'YOUTUBE' || platform === 'YOUTUBE_SHORTS') {
        // YouTube has no API flag for Shorts — it classifies a vertical video
        // under 3 minutes as one automatically — so both destinations take the
        // same upload path. The only hint the API accepts is the #Shorts tag in
        // the description, so add it when the user targeted Shorts explicitly.
        const baseDescription = [
          requestedDescription,
          ...hashtags.map((tag) => `#${tag}`),
        ]
          .filter(Boolean)
          .join(' ');
        const description =
          platform === 'YOUTUBE_SHORTS' && !/#shorts\b/i.test(baseDescription)
            ? `${baseDescription} #Shorts`.trim()
            : baseDescription;

        platformPostId = await uploadToYouTube(
          account.id,
          videoPath,
          {
            // The composer sends the title as the caption for YouTube.
            title: title || caption || post.video.title || 'Untitled',
            description,
            privacyStatus: toYouTubePrivacy(visibility),
            tags: hashtags,
            madeForKids: job.data.options?.madeForKids === true,
          },
          job,
        );
      } else if (platform === 'INSTAGRAM') {
        const videoUrl = await getSignedUrl(
          S3_BUCKETS.PROCESSED,
          post.video.processedStorageKey,
          60 * 60,
        );
        const instagramPost = await uploadToInstagram(
          account.id,
          videoUrl,
          fullCaption,
          job,
        );
        platformPostId = instagramPost.id;
        platformPostUrl = instagramPost.permalink;
      } else {
        throw new Error(`Upload not implemented for platform: ${platform}`);
      }

      await job.updateProgress(90);
    } catch (uploadError) {
      console.error(
        `Platform upload failed for post ${postId}:`,
        uploadError instanceof Error ? uploadError.message : uploadError,
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
        platformPostUrl,
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

// Map our visibility values to TikTok privacy levels
function toTikTokPrivacy(visibility: string): string {
  switch (visibility) {
    case 'private':
      return 'SELF_ONLY';
    case 'unlisted':
      return 'FOLLOWER_OF_CREATOR';
    case 'public':
    default:
      return 'PUBLIC_TO_EVERYONE';
  }
}

// Map our visibility values to YouTube privacyStatus values.
function toYouTubePrivacy(
  visibility: string,
): 'private' | 'unlisted' | 'public' {
  switch (visibility) {
    case 'private':
      return 'private';
    case 'unlisted':
      return 'unlisted';
    case 'public':
    default:
      return 'public';
  }
}

// Direct Post supports a different set of privacy values than the inbox flow.
function toTikTokDirectPrivacy(
  visibility: string,
): DirectPostOptions['privacyLevel'] {
  switch (visibility) {
    case 'private':
      return 'SELF_ONLY';
    case 'unlisted':
      return 'MUTUAL_FOLLOW_FRIENDS';
    case 'public':
    default:
      return 'PUBLIC_TO_EVERYONE';
  }
}

async function uploadToTikTok(
  account: { accessToken: string },
  videoBuffer: Buffer,
  fullCaption: string,
  visibility: string,
  job: Job<VideoJob>,
): Promise<string> {
  await job.updateProgress(50);

  const privacyLevel = toTikTokPrivacy(visibility);

  // Step 1: Initialize upload via TikTok Creator Inbox API
  // The direct post endpoint (/video/init/) requires a separate audit approval.
  // The inbox endpoint sends the video to the creator's TikTok app for final posting.
  const initResponse = await fetch(
    'https://open.tiktokapis.com/v2/post/publish/inbox/video/init/',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${account.accessToken}`,
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
    },
  );

  const initBody = await initResponse.text();
  console.log(`TikTok init response (${initResponse.status}):`, initBody);

  if (!initResponse.ok) {
    throw new Error(`TikTok init failed (${initResponse.status}): ${initBody}`);
  }

  const initData = JSON.parse(initBody) as {
    data: { publish_id: string; upload_url: string };
  };

  console.log(
    `TikTok publish_id: ${initData.data.publish_id}, upload_url: ${initData.data.upload_url}`,
  );

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

  const uploadBody = await uploadResponse.text();
  console.log(`TikTok upload response (${uploadResponse.status}):`, uploadBody);

  if (!uploadResponse.ok) {
    throw new Error(
      `TikTok upload failed (${uploadResponse.status}): ${uploadBody}`,
    );
  }

  const publishId = initData.data.publish_id;

  // Step 3: Check publish status
  const statusResponse = await fetch(
    'https://open.tiktokapis.com/v2/post/publish/status/fetch/',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${account.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ publish_id: publishId }),
    },
  );
  const statusBody = await statusResponse.text();
  console.log(`TikTok publish status (${statusResponse.status}):`, statusBody);

  return publishId;
}

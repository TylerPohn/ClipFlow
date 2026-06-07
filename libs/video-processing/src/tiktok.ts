import * as fs from 'fs';
import { stat } from 'fs/promises';

const TIKTOK_API_BASE = 'https://open.tiktokapis.com/v2';
const CHUNK_SIZE = 64 * 1024 * 1024; // 64MB

/**
 * Computes the chunk_size / total_chunk_count that TikTok's video init
 * endpoints require for a FILE_UPLOAD source. Must stay consistent with how
 * uploadVideoChunk actually transfers the file: a single chunk for files
 * <= 64MB, otherwise 64MB chunks.
 */
function computeChunking(videoSize: number): {
  chunk_size: number;
  total_chunk_count: number;
} {
  if (videoSize <= CHUNK_SIZE) {
    return { chunk_size: videoSize, total_chunk_count: 1 };
  }
  return {
    chunk_size: CHUNK_SIZE,
    total_chunk_count: Math.ceil(videoSize / CHUNK_SIZE),
  };
}

export interface TikTokInitResponse {
  publish_id: string;
  upload_url: string;
}

export interface TikTokStatusResponse {
  status: string;
}

export interface TikTokUploadResult {
  publishId: string;
  status: string;
}

export async function initializeUpload(
  accessToken: string,
  videoSize: number
): Promise<TikTokInitResponse> {
  const { chunk_size, total_chunk_count } = computeChunking(videoSize);
  const response = await fetch(
    `${TIKTOK_API_BASE}/post/publish/inbox/video/init/`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        source_info: {
          source: 'FILE_UPLOAD',
          video_size: videoSize,
          chunk_size,
          total_chunk_count,
        },
      }),
    }
  );

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(
      `TikTok initializeUpload failed: ${response.status} ${response.statusText} — ${body}`
    );
  }

  const data = (await response.json()) as { data: TikTokInitResponse };
  return data.data;
}

export async function uploadVideoChunk(
  uploadUrl: string,
  filePath: string
): Promise<void> {
  const fileStat = await stat(filePath);
  const fileSize = fileStat.size;

  if (fileSize <= CHUNK_SIZE) {
    // Single upload for files under 64MB
    const fileBuffer = await fs.promises.readFile(filePath);
    const response = await fetch(uploadUrl, {
      method: 'PUT',
      headers: {
        'Content-Range': `bytes 0-${fileSize - 1}/${fileSize}`,
        'Content-Type': 'video/mp4',
      },
      body: new Uint8Array(fileBuffer),
    });

    if (!response.ok) {
      throw new Error(
        `TikTok uploadVideoChunk failed: ${response.status} ${response.statusText}`
      );
    }
  } else {
    // Chunked upload for larger files
    let offset = 0;
    while (offset < fileSize) {
      const end = Math.min(offset + CHUNK_SIZE, fileSize);
      const chunk = await readFileChunk(filePath, offset, end - offset);

      const response = await fetch(uploadUrl, {
        method: 'PUT',
        headers: {
          'Content-Range': `bytes ${offset}-${end - 1}/${fileSize}`,
          'Content-Type': 'video/mp4',
        },
        body: new Uint8Array(chunk),
      });

      if (!response.ok) {
        throw new Error(
          `TikTok uploadVideoChunk failed at offset ${offset}: ${response.status} ${response.statusText}`
        );
      }

      offset = end;
    }
  }
}

function readFileChunk(
  filePath: string,
  start: number,
  length: number
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const stream = fs.createReadStream(filePath, {
      start,
      end: start + length - 1,
    });
    const chunks: Buffer[] = [];
    stream.on('data', (chunk) => chunks.push(chunk as Buffer));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
}

export async function checkPublishStatus(
  accessToken: string,
  publishId: string
): Promise<TikTokStatusResponse> {
  const response = await fetch(
    `${TIKTOK_API_BASE}/post/publish/status/fetch/`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ publish_id: publishId }),
    }
  );

  if (!response.ok) {
    throw new Error(
      `TikTok checkPublishStatus failed: ${response.status} ${response.statusText}`
    );
  }

  const data = (await response.json()) as { data: TikTokStatusResponse };
  return data.data;
}

export interface DirectPostOptions {
  title: string;
  privacyLevel: 'PUBLIC_TO_EVERYONE' | 'MUTUAL_FOLLOW_FRIENDS' | 'SELF_ONLY';
  disableComment?: boolean;
  disableDuet?: boolean;
  disableStitch?: boolean;
}

export async function initializeDirectPost(
  accessToken: string,
  videoSize: number,
  options: DirectPostOptions
): Promise<TikTokInitResponse> {
  const { chunk_size, total_chunk_count } = computeChunking(videoSize);
  const response = await fetch(
    `${TIKTOK_API_BASE}/post/publish/video/init/`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        post_info: {
          title: options.title,
          privacy_level: options.privacyLevel,
          disable_comment: options.disableComment ?? false,
          disable_duet: options.disableDuet ?? false,
          disable_stitch: options.disableStitch ?? false,
        },
        source_info: {
          source: 'FILE_UPLOAD',
          video_size: videoSize,
          chunk_size,
          total_chunk_count,
        },
      }),
    }
  );

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(
      `TikTok initializeDirectPost failed: ${response.status} ${response.statusText} — ${body}`
    );
  }

  const data = (await response.json()) as { data: TikTokInitResponse };
  return data.data;
}

export async function directPostToTikTok(
  accessToken: string,
  filePath: string,
  options: DirectPostOptions
): Promise<TikTokUploadResult> {
  if (!accessToken) {
    throw new Error('TikTok access token is required');
  }

  const fileStat = await stat(filePath);
  const { publish_id, upload_url } = await initializeDirectPost(
    accessToken,
    fileStat.size,
    options
  );
  await uploadVideoChunk(upload_url, filePath);

  const maxAttempts = 30;
  const pollIntervalMs = 5000;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const { status } = await checkPublishStatus(accessToken, publish_id);
    if (status === 'PUBLISH_COMPLETE') return { publishId: publish_id, status };
    if (status === 'FAILED') {
      throw new Error(`TikTok direct post failed for publish_id: ${publish_id}`);
    }
    await new Promise((r) => setTimeout(r, pollIntervalMs));
  }
  return { publishId: publish_id, status: 'PROCESSING_UPLOAD' };
}

export async function uploadToTikTok(
  accessToken: string,
  filePath: string,
  _caption: string
): Promise<TikTokUploadResult> {
  if (!accessToken) {
    throw new Error('TikTok access token is required');
  }

  const fileStat = await stat(filePath);

  // Step 1: Initialize upload
  const { publish_id, upload_url } = await initializeUpload(
    accessToken,
    fileStat.size
  );

  // Step 2: Upload the video file
  await uploadVideoChunk(upload_url, filePath);

  // Step 3: Poll for publish status
  const maxAttempts = 30;
  const pollIntervalMs = 5000;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const { status } = await checkPublishStatus(accessToken, publish_id);

    if (status === 'PUBLISH_COMPLETE') {
      return { publishId: publish_id, status };
    }

    if (status === 'FAILED') {
      throw new Error(`TikTok publish failed for publish_id: ${publish_id}`);
    }

    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  // Return last known status if polling timed out
  return { publishId: publish_id, status: 'PROCESSING_UPLOAD' };
}

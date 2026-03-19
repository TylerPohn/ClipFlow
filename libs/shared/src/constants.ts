export const QUEUE_NAME = 'video-processing';

export const S3_BUCKETS = {
  RAW: 'clipflow-raw',
  PROCESSED: 'clipflow-processed',
  THUMBNAILS: 'clipflow-thumbnails',
} as const;

export const MAX_VIDEO_DURATION_SECONDS = 600; // 10 minutes
export const MAX_FILE_SIZE_BYTES = 500 * 1024 * 1024; // 500MB

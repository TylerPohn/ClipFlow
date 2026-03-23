export enum VideoStatus {
  PENDING = 'PENDING',
  DOWNLOADING = 'DOWNLOADING',
  PROCESSING = 'PROCESSING',
  READY = 'READY',
  FAILED = 'FAILED',
}

export enum PostStatus {
  DRAFT = 'DRAFT',
  UPLOADING = 'UPLOADING',
  POSTED = 'POSTED',
  FAILED = 'FAILED',
  SCHEDULED = 'SCHEDULED',
}

export enum Platform {
  TIKTOK = 'TIKTOK',
  INSTAGRAM = 'INSTAGRAM',
  YOUTUBE_SHORTS = 'YOUTUBE_SHORTS',
  YOUTUBE = 'YOUTUBE',
  X = 'X',
}

export enum MigrationStatus {
  ACTIVE = 'ACTIVE',
  PAUSED = 'PAUSED',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
}

export enum JobType {
  DOWNLOAD = 'DOWNLOAD',
  PROCESS = 'PROCESS',
  TRANSCRIBE = 'TRANSCRIBE',
  UPLOAD = 'UPLOAD',
  YOUTUBE_SYNC = 'YOUTUBE_SYNC',
  YOUTUBE_SUBSCRIBE = 'YOUTUBE_SUBSCRIBE',
  PLATFORM_SYNC = 'PLATFORM_SYNC',
  PLATFORM_SUBSCRIBE = 'PLATFORM_SUBSCRIBE',
  SCHEDULE_CHECK = 'SCHEDULE_CHECK',
}

export interface VideoJob {
  type: JobType;
  videoId: string;
  userId: string;
  sourceUrl?: string;
  options?: Record<string, unknown>;
}

export interface PlatformSyncJob {
  type: JobType.PLATFORM_SYNC;
  data: {
    platformAccountId: string;
    specificVideoId?: string;
  };
}

export interface TranscriptWord {
  word: string;
  start: number;
  end: number;
}

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
}

export enum JobType {
  DOWNLOAD = 'DOWNLOAD',
  PROCESS = 'PROCESS',
  TRANSCRIBE = 'TRANSCRIBE',
  UPLOAD = 'UPLOAD',
  YOUTUBE_SYNC = 'YOUTUBE_SYNC',
  YOUTUBE_SUBSCRIBE = 'YOUTUBE_SUBSCRIBE',
}

export interface VideoJob {
  type: JobType;
  videoId: string;
  userId: string;
  sourceUrl?: string;
  options?: Record<string, unknown>;
}

export interface TranscriptWord {
  word: string;
  start: number;
  end: number;
}

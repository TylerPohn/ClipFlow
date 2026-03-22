import { Job } from 'bullmq';
import type { VideoJob } from '@clipflow/shared';
import { handleYouTubeSubscribe } from './youtube-subscribe';

export async function handlePlatformSubscribe(job: Job<VideoJob>) {
  // For now, just delegate to YouTube subscribe since it's the only platform with push
  await handleYouTubeSubscribe(job);
}

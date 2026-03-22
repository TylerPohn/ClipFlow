import { Job } from 'bullmq';
import type { VideoJob } from '@clipflow/shared';
import { prisma } from '@clipflow/db';

/**
 * Re-subscribes all linked YouTube channels to PubSubHubbub.
 * Should be run as a repeatable job every 4 days.
 */
export async function handleYouTubeSubscribe(job: Job<VideoJob>) {
  const platformAccounts = await prisma.platformAccount.findMany({
    where: { platform: 'YOUTUBE' },
    select: { platformUserId: true },
  });

  if (platformAccounts.length === 0) {
    console.log('No YouTube channels to re-subscribe');
    await job.updateProgress(100);
    return;
  }

  const callbackUrl = `${process.env.NEXTAUTH_URL}/api/webhooks/youtube`;
  let succeeded = 0;

  for (let i = 0; i < platformAccounts.length; i++) {
    const channelId = platformAccounts[i].platformUserId;
    const topicUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`;

    try {
      const res = await fetch('https://pubsubhubbub.appspot.com/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          'hub.callback': callbackUrl,
          'hub.topic': topicUrl,
          'hub.verify': 'async',
          'hub.mode': 'subscribe',
          'hub.lease_seconds': '432000',
        }),
      });

      if (res.ok || res.status === 202) {
        succeeded++;
      } else {
        console.error(`PubSubHubbub subscribe failed for ${channelId}: ${res.status}`);
      }
    } catch (err) {
      console.error(`PubSubHubbub subscribe error for ${channelId}:`, err);
    }

    await job.updateProgress(Math.round(((i + 1) / platformAccounts.length) * 100));
  }

  console.log(`PubSubHubbub re-subscription complete: ${succeeded}/${platformAccounts.length} succeeded`);
}

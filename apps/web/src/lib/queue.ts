import { Queue } from 'bullmq';
import { QUEUE_NAME } from '@clipflow/shared';

const connection = {
  host: new URL(process.env.REDIS_URL ?? 'redis://localhost:6379').hostname,
  port: Number(new URL(process.env.REDIS_URL ?? 'redis://localhost:6379').port) || 6379,
};

export const videoQueue = new Queue(QUEUE_NAME, { connection });

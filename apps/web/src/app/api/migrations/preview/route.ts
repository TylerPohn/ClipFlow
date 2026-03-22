import { NextResponse } from 'next/server';
import { getServerSession } from '@/lib/auth';
import { prisma } from '@clipflow/db';
import { Platform, VideoStatus } from '@clipflow/shared';

interface CadenceConfig {
  videosPerDay: number;
  timeSlots: string[];
  skipWeekends: boolean;
}

interface PreviewBody {
  sourcePlatform: string;
  destPlatform: string;
  videoIds: string[];
  cadence: CadenceConfig;
  startDate: string;
  defaultCaption?: string;
  defaultHashtags?: string[];
}

function generateSchedule(
  videoIds: string[],
  cadence: CadenceConfig,
  startDate: string
): { videoId: string; scheduledAt: Date }[] {
  const schedule: { videoId: string; scheduledAt: Date }[] = [];
  const { timeSlots, skipWeekends } = cadence;

  let currentDate = new Date(startDate + 'T00:00:00Z');
  let slotIndex = 0;

  for (const videoId of videoIds) {
    if (skipWeekends) {
      while (currentDate.getUTCDay() === 0 || currentDate.getUTCDay() === 6) {
        currentDate.setUTCDate(currentDate.getUTCDate() + 1);
      }
    }

    const [hours, minutes] = timeSlots[slotIndex].split(':').map(Number);
    const scheduledAt = new Date(currentDate);
    scheduledAt.setUTCHours(hours, minutes, 0, 0);

    schedule.push({ videoId, scheduledAt });

    slotIndex++;
    if (slotIndex >= timeSlots.length) {
      slotIndex = 0;
      currentDate.setUTCDate(currentDate.getUTCDate() + 1);
    }
  }

  return schedule;
}

function resolveCaption(template: string | undefined, videoTitle: string | null): string | null {
  if (!template) return null;
  return template.replace(/\{\{originalTitle\}\}/g, videoTitle ?? '');
}

export async function POST(request: Request) {
  const session = await getServerSession();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const userId = (session.user as { id: string }).id;
  const body = (await request.json()) as PreviewBody;

  if (
    !body.sourcePlatform ||
    !Object.values(Platform).includes(body.sourcePlatform as Platform)
  ) {
    return NextResponse.json({ error: 'Invalid source platform' }, { status: 400 });
  }

  if (
    !body.destPlatform ||
    !Object.values(Platform).includes(body.destPlatform as Platform)
  ) {
    return NextResponse.json({ error: 'Invalid destination platform' }, { status: 400 });
  }

  if (!body.videoIds || body.videoIds.length === 0) {
    return NextResponse.json({ error: 'No videos selected' }, { status: 400 });
  }

  if (!body.cadence || !body.cadence.timeSlots || body.cadence.timeSlots.length === 0) {
    return NextResponse.json({ error: 'Invalid cadence configuration' }, { status: 400 });
  }

  if (!body.startDate) {
    return NextResponse.json({ error: 'Start date is required' }, { status: 400 });
  }

  // Fetch videos to get titles for preview
  const videos = await prisma.video.findMany({
    where: {
      id: { in: body.videoIds },
      userId,
    },
    select: { id: true, title: true, status: true, processedStorageKey: true },
  });

  if (videos.length !== body.videoIds.length) {
    return NextResponse.json(
      { error: 'Some videos were not found or do not belong to you' },
      { status: 400 }
    );
  }

  const notReady = videos.filter(
    (v) => v.status !== VideoStatus.READY || !v.processedStorageKey
  );
  if (notReady.length > 0) {
    return NextResponse.json(
      {
        error: `${notReady.length} video(s) are not ready for migration`,
        videoIds: notReady.map((v) => v.id),
      },
      { status: 400 }
    );
  }

  const videoMap = new Map(videos.map((v) => [v.id, v]));
  const schedule = generateSchedule(body.videoIds, body.cadence, body.startDate);

  const preview = schedule.map((entry) => {
    const video = videoMap.get(entry.videoId)!;
    return {
      videoId: entry.videoId,
      videoTitle: video.title,
      caption: resolveCaption(body.defaultCaption, video.title),
      hashtags: body.defaultHashtags ?? [],
      scheduledAt: entry.scheduledAt,
    };
  });

  return NextResponse.json(preview);
}

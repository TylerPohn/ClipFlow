import { NextResponse } from 'next/server';
import { getServerSession } from '@/lib/auth';
import { Platform } from '@clipflow/shared';

interface CadenceConfig {
  videosPerDay: number;
  timeSlots: string[];
  skipWeekends: boolean;
}

interface SourceVideo {
  youtubeVideoId: string;
  clipflowVideoId?: string | null;
  title: string;
}

interface PreviewBody {
  sourcePlatform: string;
  destPlatform: string;
  videos: SourceVideo[];
  cadence: CadenceConfig;
  startDate: string;
  tzOffset?: number;
  defaultCaption?: string;
  defaultHashtags?: string[];
}

function generateSchedule(
  videos: SourceVideo[],
  cadence: CadenceConfig,
  startDate: string,
  tzOffset: number
): { video: SourceVideo; scheduledAt: Date }[] {
  const schedule: { video: SourceVideo; scheduledAt: Date }[] = [];
  const { timeSlots, skipWeekends } = cadence;

  let currentDate = new Date(startDate + 'T12:00:00Z');
  let slotIndex = 0;

  for (const video of videos) {
    if (skipWeekends) {
      while (currentDate.getUTCDay() === 0 || currentDate.getUTCDay() === 6) {
        currentDate.setUTCDate(currentDate.getUTCDate() + 1);
      }
    }

    const [hours, minutes] = timeSlots[slotIndex].split(':').map(Number);
    const localMs = Date.UTC(
      currentDate.getUTCFullYear(),
      currentDate.getUTCMonth(),
      currentDate.getUTCDate(),
      hours,
      minutes,
      0,
      0
    );
    const scheduledAt = new Date(localMs + tzOffset * 60 * 1000);

    schedule.push({ video, scheduledAt });

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

  if (!body.videos || body.videos.length === 0) {
    return NextResponse.json({ error: 'No videos selected' }, { status: 400 });
  }

  if (!body.cadence || !body.cadence.timeSlots || body.cadence.timeSlots.length === 0) {
    return NextResponse.json({ error: 'Invalid cadence configuration' }, { status: 400 });
  }

  if (!body.startDate) {
    return NextResponse.json({ error: 'Start date is required' }, { status: 400 });
  }

  const schedule = generateSchedule(body.videos, body.cadence, body.startDate, body.tzOffset ?? 0);

  const preview = schedule.map((entry) => ({
    youtubeVideoId: entry.video.youtubeVideoId,
    videoTitle: entry.video.title,
    caption: resolveCaption(body.defaultCaption, entry.video.title),
    hashtags: body.defaultHashtags ?? [],
    scheduledAt: entry.scheduledAt,
  }));

  return NextResponse.json(preview);
}

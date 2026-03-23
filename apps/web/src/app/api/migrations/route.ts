import { NextResponse } from 'next/server';
import { getServerSession } from '@/lib/auth';
import { prisma } from '@clipflow/db';
import { MigrationStatus, Platform, PostStatus, VideoStatus } from '@clipflow/shared';

interface CadenceConfig {
  videosPerDay: number;
  timeSlots: string[];
  skipWeekends: boolean;
}

interface SourceVideo {
  youtubeVideoId: string;
  clipflowVideoId?: string | null;
  title: string;
  description?: string;
  thumbnailUrl?: string | null;
  duration?: number | null;
}

interface CreateMigrationBody {
  sourcePlatform: string;
  destPlatform: string;
  videos: SourceVideo[];
  cadence: CadenceConfig;
  startDate: string;
  tzOffset?: number; // minutes from UTC (e.g. 300 for CDT/UTC-5)
  defaultCaption?: string;
  defaultHashtags?: string[];
  defaultSettings?: Record<string, unknown>;
  name?: string;
}

function generateSchedule(
  videoIds: string[],
  cadence: CadenceConfig,
  startDate: string,
  tzOffset: number // minutes from UTC (positive = behind UTC, e.g. 300 for CDT)
): { videoId: string; scheduledAt: Date }[] {
  const schedule: { videoId: string; scheduledAt: Date }[] = [];
  const { timeSlots, skipWeekends } = cadence;

  // Work in local dates by tracking day as a plain string, then convert to UTC at the end
  let currentDate = new Date(startDate + 'T12:00:00Z'); // noon UTC to avoid DST edge cases
  let slotIndex = 0;

  for (const videoId of videoIds) {
    // Skip weekends (check in local time context)
    if (skipWeekends) {
      while (currentDate.getUTCDay() === 0 || currentDate.getUTCDay() === 6) {
        currentDate.setUTCDate(currentDate.getUTCDate() + 1);
      }
    }

    const [hours, minutes] = timeSlots[slotIndex].split(':').map(Number);
    // Build the local datetime, then convert to UTC by adding the offset
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
  const body = (await request.json()) as CreateMigrationBody;

  // Validate platforms
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

  // Validate destination platform account is linked
  const platformAccount = await prisma.platformAccount.findFirst({
    where: {
      userId,
      platform: body.destPlatform as Platform,
    },
  });

  if (!platformAccount) {
    return NextResponse.json(
      { error: `No ${body.destPlatform} account linked. Please connect your account first.` },
      { status: 400 }
    );
  }

  // Resolve ClipFlow video IDs: use existing ones or auto-import
  const resolvedVideoIds: string[] = [];
  const videoTitleMap = new Map<string, string | null>();

  for (const sv of body.videos) {
    if (sv.clipflowVideoId) {
      // Already imported — verify it exists and belongs to user
      const existing = await prisma.video.findFirst({
        where: { id: sv.clipflowVideoId, userId },
      });
      if (existing) {
        resolvedVideoIds.push(existing.id);
        videoTitleMap.set(existing.id, existing.title);
        continue;
      }
    }

    // Check if already imported by sourceUrl
    const sourceUrl = `https://www.youtube.com/watch?v=${sv.youtubeVideoId}`;
    const existingByUrl = await prisma.video.findFirst({
      where: { userId, sourceUrl },
    });

    if (existingByUrl) {
      resolvedVideoIds.push(existingByUrl.id);
      videoTitleMap.set(existingByUrl.id, existingByUrl.title);
      continue;
    }

    // Auto-import: create a PENDING video record
    const video = await prisma.video.create({
      data: {
        userId,
        sourceUrl,
        title: sv.title,
        description: sv.description ?? null,
        thumbnailUrl: sv.thumbnailUrl ?? null,
        duration: sv.duration ?? null,
        status: VideoStatus.PENDING,
      },
    });

    resolvedVideoIds.push(video.id);
    videoTitleMap.set(video.id, video.title);
  }

  // Generate schedule (tzOffset defaults to 0 = UTC if not provided)
  const schedule = generateSchedule(resolvedVideoIds, body.cadence, body.startDate, body.tzOffset ?? 0);

  // Create migration and posts in a transaction
  const migration = await prisma.$transaction(async (tx) => {
    const mig = await tx.migration.create({
      data: {
        userId,
        name: body.name ?? null,
        sourcePlatform: body.sourcePlatform as Platform,
        destPlatform: body.destPlatform as Platform,
        status: MigrationStatus.ACTIVE,
        cadence: body.cadence as object,
        defaultCaption: body.defaultCaption ?? null,
        defaultHashtags: body.defaultHashtags ?? [],
        defaultSettings: body.defaultSettings as object ?? undefined,
      },
    });

    const postData = schedule.map((entry) => {
      const title = videoTitleMap.get(entry.videoId) ?? null;
      return {
        videoId: entry.videoId,
        platform: body.destPlatform as Platform,
        caption: resolveCaption(body.defaultCaption, title),
        hashtags: body.defaultHashtags ?? [],
        status: PostStatus.SCHEDULED,
        scheduledAt: entry.scheduledAt,
        migrationId: mig.id,
      };
    });

    await tx.post.createMany({ data: postData });

    return tx.migration.findUnique({
      where: { id: mig.id },
      include: {
        posts: {
          include: { video: { select: { id: true, title: true, thumbnailUrl: true } } },
          orderBy: { scheduledAt: 'asc' },
        },
      },
    });
  });

  return NextResponse.json(migration, { status: 201 });
}

export async function GET() {
  const session = await getServerSession();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const userId = (session.user as { id: string }).id;

  const migrations = await prisma.migration.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    include: {
      posts: {
        select: { status: true },
      },
    },
  });

  const result = migrations.map((mig) => {
    const counts = {
      total: mig.posts.length,
      posted: mig.posts.filter((p) => p.status === PostStatus.POSTED).length,
      failed: mig.posts.filter((p) => p.status === PostStatus.FAILED).length,
      scheduled: mig.posts.filter((p) => p.status === PostStatus.SCHEDULED).length,
      uploading: mig.posts.filter((p) => p.status === PostStatus.UPLOADING).length,
    };

    const { posts, ...migData } = mig;
    return { ...migData, counts };
  });

  return NextResponse.json(result);
}

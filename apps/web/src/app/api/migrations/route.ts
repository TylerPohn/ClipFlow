import { NextResponse } from 'next/server';
import { getServerSession } from '@/lib/auth';
import { prisma } from '@clipflow/db';
import { MigrationStatus, Platform, PostStatus } from '@clipflow/shared';

interface CadenceConfig {
  videosPerDay: number;
  timeSlots: string[];
  skipWeekends: boolean;
}

interface CreateMigrationBody {
  sourcePlatform: string;
  destPlatform: string;
  videoIds: string[];
  cadence: CadenceConfig;
  startDate: string;
  defaultCaption?: string;
  defaultHashtags?: string[];
  defaultSettings?: Record<string, unknown>;
  name?: string;
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
    // Skip weekends if configured
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

  if (!body.videoIds || body.videoIds.length === 0) {
    return NextResponse.json({ error: 'No videos selected' }, { status: 400 });
  }

  if (!body.cadence || !body.cadence.timeSlots || body.cadence.timeSlots.length === 0) {
    return NextResponse.json({ error: 'Invalid cadence configuration' }, { status: 400 });
  }

  if (!body.startDate) {
    return NextResponse.json({ error: 'Start date is required' }, { status: 400 });
  }

  // Validate all videos exist and belong to user
  const videos = await prisma.video.findMany({
    where: {
      id: { in: body.videoIds },
      userId,
    },
  });

  if (videos.length !== body.videoIds.length) {
    return NextResponse.json(
      { error: 'Some videos were not found or do not belong to you' },
      { status: 400 }
    );
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

  // Generate schedule
  const schedule = generateSchedule(body.videoIds, body.cadence, body.startDate);

  // Build a map of videoId -> video for caption resolution
  const videoMap = new Map(videos.map((v) => [v.id, v]));

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
      const video = videoMap.get(entry.videoId)!;
      return {
        videoId: entry.videoId,
        platform: body.destPlatform as Platform,
        caption: resolveCaption(body.defaultCaption, video.title),
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

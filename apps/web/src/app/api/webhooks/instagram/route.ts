import { NextResponse } from 'next/server';
import { createHmac, timingSafeEqual } from 'crypto';
import { prisma } from '@clipflow/db';
import { videoQueue } from '@/lib/queue';
import { JobType } from '@clipflow/shared';

/**
 * Verify the Meta webhook signature (HMAC-SHA256 of raw body using app secret).
 * Meta sends X-Hub-Signature-256 header with "sha256=<hex>" format.
 */
function verifySignature(rawBody: string, signatureHeader: string): boolean {
  const secret = process.env.INSTAGRAM_APP_SECRET;
  if (!secret || !signatureHeader) return false;

  const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
  const received = signatureHeader.replace('sha256=', '');

  if (expected.length !== received.length) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(received));
}

/**
 * GET: Meta webhook verification challenge.
 * Meta sends hub.mode, hub.verify_token, and hub.challenge as query params.
 * We verify the token and echo back the challenge.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const mode = searchParams.get('hub.mode');
  const token = searchParams.get('hub.verify_token');
  const challenge = searchParams.get('hub.challenge');

  if (
    mode === 'subscribe' &&
    token === process.env.INSTAGRAM_WEBHOOK_VERIFY_TOKEN
  ) {
    return new NextResponse(challenge, {
      status: 200,
      headers: { 'Content-Type': 'text/plain' },
    });
  }

  return NextResponse.json({ error: 'Verification failed' }, { status: 403 });
}

interface WebhookChange {
  field: string;
  value: Record<string, unknown>;
}

interface WebhookEntry {
  id: string;
  time: number;
  changes: WebhookChange[];
}

interface WebhookPayload {
  object: string;
  entry: WebhookEntry[];
}

/**
 * POST: Meta sends webhook events for subscribed fields.
 * Verifies signature, then routes by field type.
 */
export async function POST(request: Request) {
  const rawBody = await request.text();

  // Verify signature
  const signatureHeader = request.headers.get('x-hub-signature-256') ?? '';
  if (!verifySignature(rawBody, signatureHeader)) {
    console.warn('[Instagram Webhook] Invalid signature');
    return NextResponse.json({ error: 'Invalid signature' }, { status: 403 });
  }

  let body: WebhookPayload;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  console.log('[Instagram Webhook] Event received:', JSON.stringify(body, null, 2));

  if (body.object !== 'instagram' || !body.entry) {
    return NextResponse.json({ status: 'ok' });
  }

  for (const entry of body.entry) {
    const igUserId = entry.id;

    for (const change of entry.changes) {
      if (change.field === 'media') {
        // A Reel was published or updated — trigger a sync
        const platformAccount = await prisma.platformAccount.findFirst({
          where: { platform: 'INSTAGRAM', platformUserId: igUserId },
        });

        if (platformAccount) {
          const mediaId = change.value.media_id as string | undefined;
          await videoQueue.add(`instagram-sync-${igUserId}`, {
            type: JobType.PLATFORM_SYNC,
            videoId: '',
            userId: platformAccount.userId,
            options: {
              platformAccountId: platformAccount.id,
              specificVideoId: mediaId,
            },
          });
          console.log(`[Instagram Webhook] Queued sync for IG user ${igUserId}, media ${mediaId ?? 'all'}`);
        } else {
          console.log(`[Instagram Webhook] No platformAccount found for IG user ${igUserId}`);
        }
      }

      if (change.field === 'comments') {
        // Comment activity — trigger a sync to update counts
        const platformAccount = await prisma.platformAccount.findFirst({
          where: { platform: 'INSTAGRAM', platformUserId: igUserId },
        });

        if (platformAccount) {
          await videoQueue.add(`instagram-comment-sync-${igUserId}`, {
            type: JobType.PLATFORM_SYNC,
            videoId: '',
            userId: platformAccount.userId,
            options: {
              platformAccountId: platformAccount.id,
            },
          });
          console.log(`[Instagram Webhook] Queued comment sync for IG user ${igUserId}`);
        }
      }
    }
  }

  // Meta expects a 200 response within 20 seconds
  return NextResponse.json({ status: 'ok' });
}

import { NextResponse } from 'next/server';
import { createHmac } from 'crypto';
import { prisma } from '@clipflow/db';
import { videoQueue } from '@/lib/queue';
import { JobType } from '@clipflow/shared';

/**
 * Verify the TikTok webhook signature (HMAC-SHA256 of raw body using client secret).
 */
function verifySignature(rawBody: string, signature: string): boolean {
  const secret = process.env.TIKTOK_CLIENT_SECRET;
  if (!secret) return false;

  const hmac = createHmac('sha256', secret).update(rawBody).digest('hex');
  return hmac === signature;
}

/**
 * POST: Handles both TikTok webhook verification and event delivery.
 *
 * Verification: TikTok POSTs { "challenge": "some_string" } and expects it echoed back.
 * Events: TikTok POSTs event payloads with an X-Tiktok-Signature header.
 */
export async function POST(request: Request) {
  const rawBody = await request.text();
  let body: Record<string, unknown>;

  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  // Handle verification challenge
  if (typeof body.challenge === 'string') {
    console.log('[TikTok Webhook] Verification challenge received');
    return NextResponse.json({ challenge: body.challenge });
  }

  // Verify signature for real events
  const signature = request.headers.get('x-tiktok-signature') ?? '';
  if (!verifySignature(rawBody, signature)) {
    console.warn('[TikTok Webhook] Invalid signature');
    return NextResponse.json({ error: 'Invalid signature' }, { status: 403 });
  }

  const event = body.event as string | undefined;
  console.log('[TikTok Webhook] Event received:', event, JSON.stringify(body, null, 2));

  // Handle video status update events
  if (event === 'video.publish' || event === 'video.update') {
    const data = body.data as Record<string, unknown> | undefined;
    const openId = (body.user as Record<string, unknown>)?.open_id as string | undefined;

    if (openId && data) {
      const platformAccount = await prisma.platformAccount.findFirst({
        where: { platform: 'TIKTOK', platformUserId: openId },
      });

      if (platformAccount) {
        await videoQueue.add(`tiktok-sync-${openId}`, {
          type: JobType.PLATFORM_SYNC,
          videoId: '',
          userId: platformAccount.userId,
          options: {
            platformAccountId: platformAccount.id,
            specificVideoId: data.video_id as string | undefined,
          },
        });
      }
    }
  }

  // TikTok expects 200 within a few seconds
  return NextResponse.json({ status: 'ok' });
}

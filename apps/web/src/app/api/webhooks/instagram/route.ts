import { NextResponse } from 'next/server';

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

/**
 * POST: Meta sends webhook events for subscribed fields.
 * For now we acknowledge receipt — extend as needed.
 */
export async function POST(request: Request) {
  const body = await request.json();

  // Log for debugging during development
  console.log('[Instagram Webhook]', JSON.stringify(body, null, 2));

  // Meta expects a 200 response within 20 seconds
  return NextResponse.json({ status: 'ok' });
}

import { NextResponse } from 'next/server';
import { getServerSession } from '@/lib/auth';
import * as crypto from 'crypto';

export async function GET(request: Request) {
  // Build redirects from the public app origin (NEXTAUTH_URL) rather than the
  // internal request host, which behind the Cloudflare tunnel is localhost:3100.
  const baseUrl = process.env.NEXTAUTH_URL ?? new URL(request.url).origin;

  const session = await getServerSession();
  if (!session?.user) {
    return NextResponse.redirect(new URL('/login', baseUrl));
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) {
    return NextResponse.json({ error: 'YouTube not configured' }, { status: 500 });
  }

  const { searchParams } = new URL(request.url);
  const returnTo = searchParams.get('returnTo') ?? '/dashboard';

  const state = crypto.randomBytes(16).toString('hex');
  const redirectUri = `${baseUrl}/api/auth/youtube/callback`;

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'https://www.googleapis.com/auth/youtube.readonly https://www.googleapis.com/auth/youtube.upload',
    access_type: 'offline',
    prompt: 'consent',
    state,
  });

  const response = NextResponse.redirect(
    `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`
  );
  response.cookies.set('youtube_oauth_state', state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 600,
    path: '/',
  });
  response.cookies.set('youtube_return_to', returnTo, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 600,
    path: '/',
  });

  return response;
}

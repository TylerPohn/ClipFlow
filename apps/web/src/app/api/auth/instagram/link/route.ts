import { NextResponse } from 'next/server';
import { getServerSession } from '@/lib/auth';
import * as crypto from 'crypto';

export async function GET(request: Request) {
  const session = await getServerSession();
  if (!session?.user) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  const clientId = process.env.INSTAGRAM_CLIENT_ID;
  if (!clientId) {
    return NextResponse.json({ error: 'Instagram not configured' }, { status: 500 });
  }

  const { searchParams } = new URL(request.url);
  const returnTo = searchParams.get('returnTo') ?? '/dashboard';

  const state = crypto.randomBytes(16).toString('hex');
  const redirectUri = `${process.env.NEXTAUTH_URL}/api/auth/instagram/callback`;

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: 'instagram_basic,instagram_content_publish,pages_show_list,pages_read_engagement',
    response_type: 'code',
    state,
  });

  const response = NextResponse.redirect(
    `https://www.facebook.com/v21.0/dialog/oauth?${params.toString()}`
  );
  response.cookies.set('instagram_oauth_state', state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 600,
    path: '/',
  });
  response.cookies.set('instagram_return_to', returnTo, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 600,
    path: '/',
  });

  return response;
}

import { NextResponse } from 'next/server';
import { getServerSession } from '@/lib/auth';
import {
  getInstagramRedirectUri,
  sanitizeInstagramReturnTo,
} from '@/lib/instagram-oauth';
import * as crypto from 'crypto';

export async function GET(request: Request) {
  const session = await getServerSession();
  if (!session?.user) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  const clientId = process.env.INSTAGRAM_CLIENT_ID;
  if (!clientId) {
    return NextResponse.json(
      { error: 'Instagram not configured' },
      { status: 500 },
    );
  }

  const { searchParams } = new URL(request.url);
  const returnTo = sanitizeInstagramReturnTo(searchParams.get('returnTo'));

  const state = crypto.randomBytes(16).toString('hex');
  const redirectUri = getInstagramRedirectUri(request);

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: 'instagram_business_basic,instagram_business_content_publish',
    response_type: 'code',
    state,
    enable_fb_login: '0',
    force_authentication: '1',
  });

  const response = NextResponse.redirect(
    `https://www.instagram.com/oauth/authorize?${params.toString()}`,
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

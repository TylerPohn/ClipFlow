import { NextResponse } from 'next/server';
import { getServerSession } from '@/lib/auth';
import { prisma } from '@clipflow/db';
import { cookies } from 'next/headers';

export async function GET(request: Request) {
  const session = await getServerSession();
  if (!session?.user) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  const userId = (session.user as { id: string }).id;
  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code');
  const state = searchParams.get('state');
  const error = searchParams.get('error');

  const cookieStore = await cookies();
  const savedState = cookieStore.get('tiktok_oauth_state')?.value;
  const returnTo = cookieStore.get('tiktok_return_to')?.value ?? '/dashboard';

  // Clean up cookies
  cookieStore.delete('tiktok_oauth_state');
  cookieStore.delete('tiktok_return_to');

  if (error) {
    return NextResponse.redirect(
      new URL(`${returnTo}?tiktok_error=${error}`, process.env.NEXTAUTH_URL)
    );
  }

  if (!code || !state || state !== savedState) {
    return NextResponse.redirect(
      new URL(`${returnTo}?tiktok_error=invalid_state`, process.env.NEXTAUTH_URL)
    );
  }

  const clientKey = process.env.TIKTOK_CLIENT_KEY!;
  const clientSecret = process.env.TIKTOK_CLIENT_SECRET!;
  const redirectUri = `${process.env.NEXTAUTH_URL}/api/auth/tiktok/callback`;

  // Exchange code for tokens
  const tokenRes = await fetch('https://open.tiktokapis.com/v2/oauth/token/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_key: clientKey,
      client_secret: clientSecret,
      code,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
    }),
  });

  const tokenData = await tokenRes.json();

  if (!tokenData.access_token) {
    console.error('TikTok token exchange failed:', tokenData);
    return NextResponse.redirect(
      new URL(`${returnTo}?tiktok_error=token_failed`, request.url)
    );
  }

  const openId = tokenData.open_id;

  // Upsert the TikTok account linked to the current user
  await prisma.account.upsert({
    where: {
      provider_providerAccountId: {
        provider: 'tiktok',
        providerAccountId: openId,
      },
    },
    update: {
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token ?? null,
      expires_at: tokenData.expires_in
        ? Math.floor(Date.now() / 1000) + tokenData.expires_in
        : null,
      token_type: tokenData.token_type ?? 'Bearer',
      scope: tokenData.scope ?? 'user.info.basic,video.publish',
    },
    create: {
      userId,
      type: 'oauth',
      provider: 'tiktok',
      providerAccountId: openId,
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token ?? null,
      expires_at: tokenData.expires_in
        ? Math.floor(Date.now() / 1000) + tokenData.expires_in
        : null,
      token_type: tokenData.token_type ?? 'Bearer',
      scope: tokenData.scope ?? 'user.info.basic,video.publish',
    },
  });

  return NextResponse.redirect(new URL(returnTo, process.env.NEXTAUTH_URL));
}

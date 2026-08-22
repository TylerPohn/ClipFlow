import { NextResponse } from 'next/server';
import { getServerSession } from '@/lib/auth';
import { prisma } from '@clipflow/db';
import { cookies } from 'next/headers';
import {
  getInstagramOrigin,
  getInstagramRedirectUri,
  sanitizeInstagramReturnTo,
} from '@/lib/instagram-oauth';

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
  const savedState = cookieStore.get('instagram_oauth_state')?.value;
  const returnTo = sanitizeInstagramReturnTo(
    cookieStore.get('instagram_return_to')?.value ?? null,
  );
  const origin = getInstagramOrigin(request);

  // Clean up cookies
  cookieStore.delete('instagram_oauth_state');
  cookieStore.delete('instagram_return_to');

  if (error) {
    return NextResponse.redirect(
      new URL(`${returnTo}?instagram_error=${error}`, origin),
    );
  }

  if (!code || !state || state !== savedState) {
    return NextResponse.redirect(
      new URL(`${returnTo}?instagram_error=invalid_state`, origin),
    );
  }

  const clientId = process.env.INSTAGRAM_CLIENT_ID!;
  const clientSecret = process.env.INSTAGRAM_CLIENT_SECRET!;
  const redirectUri = getInstagramRedirectUri(request);

  // 1. Exchange code for short-lived token via Instagram API
  const tokenRes = await fetch('https://api.instagram.com/oauth/access_token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
      code,
    }),
  });
  const tokenData = await tokenRes.json();

  if (!tokenData.access_token) {
    console.error('Instagram token exchange failed:', tokenData);
    return NextResponse.redirect(
      new URL(`${returnTo}?instagram_error=token_failed`, origin),
    );
  }

  // 2. Exchange for long-lived token (60-day expiry)
  const longLivedRes = await fetch(
    `https://graph.instagram.com/access_token?${new URLSearchParams({
      grant_type: 'ig_exchange_token',
      client_secret: clientSecret,
      access_token: tokenData.access_token,
    })}`,
  );
  const longLivedData = await longLivedRes.json();

  const accessToken = longLivedData.access_token ?? tokenData.access_token;
  const expiresIn = longLivedData.expires_in ?? 3600;

  // 3. Get Instagram user profile
  const profileRes = await fetch(
    `https://graph.instagram.com/v21.0/me?fields=user_id,username&access_token=${accessToken}`,
  );
  const profileData = await profileRes.json();

  const igUserId = profileData.user_id ?? tokenData.user_id;
  const igUsername = profileData.username ?? null;

  if (!igUserId) {
    console.error('Could not get Instagram user ID:', profileData);
    return NextResponse.redirect(
      new URL(`${returnTo}?instagram_error=no_ig_account`, origin),
    );
  }

  const tokenExpiresAt = new Date(Date.now() + expiresIn * 1000);

  // 4. Upsert PlatformAccount
  await prisma.platformAccount.upsert({
    where: {
      userId_platform_platformUserId: {
        userId,
        platform: 'INSTAGRAM',
        platformUserId: String(igUserId),
      },
    },
    update: {
      accessToken,
      refreshToken: null,
      tokenExpiresAt,
      handle: igUsername,
    },
    create: {
      userId,
      platform: 'INSTAGRAM',
      platformUserId: String(igUserId),
      accessToken,
      refreshToken: null,
      tokenExpiresAt,
      handle: igUsername,
    },
  });

  // 5. Upsert NextAuth Account for backwards compatibility
  await prisma.account.upsert({
    where: {
      provider_providerAccountId: {
        provider: 'instagram',
        providerAccountId: String(igUserId),
      },
    },
    update: {
      access_token: accessToken,
      refresh_token: null,
      expires_at: Math.floor(Date.now() / 1000) + expiresIn,
      token_type: 'Bearer',
      scope: 'instagram_business_basic,instagram_business_content_publish',
    },
    create: {
      userId,
      type: 'oauth',
      provider: 'instagram',
      providerAccountId: String(igUserId),
      access_token: accessToken,
      refresh_token: null,
      expires_at: Math.floor(Date.now() / 1000) + expiresIn,
      token_type: 'Bearer',
      scope: 'instagram_business_basic,instagram_business_content_publish',
    },
  });

  return NextResponse.redirect(new URL(returnTo, origin));
}

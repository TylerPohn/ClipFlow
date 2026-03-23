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
  const savedState = cookieStore.get('x_oauth_state')?.value;
  const codeVerifier = cookieStore.get('x_code_verifier')?.value;
  const returnTo = cookieStore.get('x_return_to')?.value ?? '/dashboard';

  cookieStore.delete('x_oauth_state');
  cookieStore.delete('x_code_verifier');
  cookieStore.delete('x_return_to');

  if (error) {
    return NextResponse.redirect(
      new URL(`${returnTo}?x_error=${error}`, process.env.NEXTAUTH_URL)
    );
  }

  if (!code || !state || state !== savedState || !codeVerifier) {
    return NextResponse.redirect(
      new URL(`${returnTo}?x_error=invalid_state`, process.env.NEXTAUTH_URL)
    );
  }

  const clientId = process.env.X_CLIENT_ID!;
  const clientSecret = process.env.X_CLIENT_SECRET!;
  const redirectUri = `${process.env.NEXTAUTH_URL}/api/auth/x/callback`;

  // Exchange code for tokens (Basic auth with client credentials)
  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

  const tokenRes = await fetch('https://api.x.com/2/oauth2/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${credentials}`,
    },
    body: new URLSearchParams({
      code,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
      code_verifier: codeVerifier,
    }),
  });

  const tokenData = await tokenRes.json();

  if (!tokenData.access_token) {
    console.error('X token exchange failed:', tokenData);
    return NextResponse.redirect(
      new URL(`${returnTo}?x_error=token_failed`, process.env.NEXTAUTH_URL)
    );
  }

  // Fetch user profile
  const userRes = await fetch(
    'https://api.x.com/2/users/me?user.fields=profile_image_url,username,name',
    { headers: { Authorization: `Bearer ${tokenData.access_token}` } }
  );

  const userData = await userRes.json();

  if (!userData.data?.id) {
    console.error('X user fetch failed:', userData);
    return NextResponse.redirect(
      new URL(`${returnTo}?x_error=user_fetch_failed`, process.env.NEXTAUTH_URL)
    );
  }

  const tokenExpiresAt = tokenData.expires_in
    ? new Date(Date.now() + tokenData.expires_in * 1000)
    : null;
  const expiresAtEpoch = tokenData.expires_in
    ? Math.floor(Date.now() / 1000) + tokenData.expires_in
    : null;

  // Upsert PlatformAccount (primary record)
  await prisma.platformAccount.upsert({
    where: {
      userId_platform_platformUserId: {
        userId,
        platform: 'X',
        platformUserId: userData.data.id,
      },
    },
    update: {
      displayName: userData.data.name,
      handle: userData.data.username,
      avatarUrl: userData.data.profile_image_url ?? null,
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token ?? null,
      tokenExpiresAt,
    },
    create: {
      userId,
      platform: 'X',
      platformUserId: userData.data.id,
      displayName: userData.data.name,
      handle: userData.data.username,
      avatarUrl: userData.data.profile_image_url ?? null,
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token ?? null,
      tokenExpiresAt,
    },
  });

  // Upsert legacy Account record for backwards compat
  await prisma.account.upsert({
    where: {
      provider_providerAccountId: {
        provider: 'x',
        providerAccountId: userData.data.id,
      },
    },
    update: {
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token ?? null,
      expires_at: expiresAtEpoch,
      token_type: tokenData.token_type ?? 'bearer',
      scope: tokenData.scope ?? 'tweet.read tweet.write users.read offline.access',
    },
    create: {
      userId,
      type: 'oauth',
      provider: 'x',
      providerAccountId: userData.data.id,
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token ?? null,
      expires_at: expiresAtEpoch,
      token_type: tokenData.token_type ?? 'bearer',
      scope: tokenData.scope ?? 'tweet.read tweet.write users.read offline.access',
    },
  });

  return NextResponse.redirect(new URL(returnTo, process.env.NEXTAUTH_URL));
}

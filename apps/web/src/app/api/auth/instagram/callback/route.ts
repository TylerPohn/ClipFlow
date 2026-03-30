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
  const savedState = cookieStore.get('instagram_oauth_state')?.value;
  const returnTo = cookieStore.get('instagram_return_to')?.value ?? '/dashboard';

  // Clean up cookies
  cookieStore.delete('instagram_oauth_state');
  cookieStore.delete('instagram_return_to');

  if (error) {
    return NextResponse.redirect(
      new URL(`${returnTo}?instagram_error=${error}`, process.env.NEXTAUTH_URL)
    );
  }

  if (!code || !state || state !== savedState) {
    return NextResponse.redirect(
      new URL(`${returnTo}?instagram_error=invalid_state`, process.env.NEXTAUTH_URL)
    );
  }

  const clientId = process.env.INSTAGRAM_CLIENT_ID!;
  const clientSecret = process.env.INSTAGRAM_CLIENT_SECRET!;
  const redirectUri = `${process.env.NEXTAUTH_URL}/api/auth/instagram/callback`;

  // 1. Exchange code for short-lived token
  const tokenRes = await fetch(
    `https://graph.facebook.com/v21.0/oauth/access_token?${new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      code,
    })}`,
  );
  const tokenData = await tokenRes.json();

  if (!tokenData.access_token) {
    console.error('Instagram token exchange failed:', tokenData);
    return NextResponse.redirect(
      new URL(`${returnTo}?instagram_error=token_failed`, process.env.NEXTAUTH_URL)
    );
  }

  // 2. Exchange for long-lived token (60-day expiry)
  const longLivedRes = await fetch(
    `https://graph.facebook.com/v21.0/oauth/access_token?${new URLSearchParams({
      grant_type: 'fb_exchange_token',
      client_id: clientId,
      client_secret: clientSecret,
      fb_exchange_token: tokenData.access_token,
    })}`,
  );
  const longLivedData = await longLivedRes.json();

  const accessToken = longLivedData.access_token ?? tokenData.access_token;
  const expiresIn = longLivedData.expires_in ?? tokenData.expires_in;

  // 3. Get Facebook Pages
  const pagesRes = await fetch(
    `https://graph.facebook.com/v21.0/me/accounts?access_token=${accessToken}`,
  );
  const pagesData = await pagesRes.json();

  if (!pagesData.data?.length) {
    console.error('No Facebook Pages found:', pagesData);
    return NextResponse.redirect(
      new URL(`${returnTo}?instagram_error=no_pages`, process.env.NEXTAUTH_URL)
    );
  }

  // 4. Find the Instagram Business Account from the first page with one
  let igUserId: string | null = null;
  let igUsername: string | null = null;
  let pageAccessToken: string = accessToken;

  for (const page of pagesData.data) {
    const igRes = await fetch(
      `https://graph.facebook.com/v21.0/${page.id}?fields=instagram_business_account&access_token=${page.access_token}`,
    );
    const igData = await igRes.json();

    if (igData.instagram_business_account?.id) {
      igUserId = igData.instagram_business_account.id;
      pageAccessToken = page.access_token;

      // Get the IG username
      const profileRes = await fetch(
        `https://graph.facebook.com/v21.0/${igUserId}?fields=username&access_token=${pageAccessToken}`,
      );
      const profileData = await profileRes.json();
      igUsername = profileData.username ?? null;
      break;
    }
  }

  if (!igUserId) {
    console.error('No Instagram Business Account found on any Page');
    return NextResponse.redirect(
      new URL(`${returnTo}?instagram_error=no_ig_business_account`, process.env.NEXTAUTH_URL)
    );
  }

  const tokenExpiresAt = expiresIn
    ? new Date(Date.now() + expiresIn * 1000)
    : null;

  // 5. Upsert PlatformAccount
  await prisma.platformAccount.upsert({
    where: {
      userId_platform_platformUserId: {
        userId,
        platform: 'INSTAGRAM',
        platformUserId: igUserId,
      },
    },
    update: {
      accessToken: pageAccessToken,
      refreshToken: null,
      tokenExpiresAt,
      handle: igUsername,
    },
    create: {
      userId,
      platform: 'INSTAGRAM',
      platformUserId: igUserId,
      accessToken: pageAccessToken,
      refreshToken: null,
      tokenExpiresAt,
      handle: igUsername,
    },
  });

  // 6. Upsert NextAuth Account for backwards compatibility
  await prisma.account.upsert({
    where: {
      provider_providerAccountId: {
        provider: 'instagram',
        providerAccountId: igUserId,
      },
    },
    update: {
      access_token: pageAccessToken,
      refresh_token: null,
      expires_at: expiresIn
        ? Math.floor(Date.now() / 1000) + expiresIn
        : null,
      token_type: 'Bearer',
      scope: 'instagram_basic,instagram_content_publish,pages_show_list,pages_read_engagement',
    },
    create: {
      userId,
      type: 'oauth',
      provider: 'instagram',
      providerAccountId: igUserId,
      access_token: pageAccessToken,
      refresh_token: null,
      expires_at: expiresIn
        ? Math.floor(Date.now() / 1000) + expiresIn
        : null,
      token_type: 'Bearer',
      scope: 'instagram_basic,instagram_content_publish,pages_show_list,pages_read_engagement',
    },
  });

  return NextResponse.redirect(new URL(returnTo, process.env.NEXTAUTH_URL));
}

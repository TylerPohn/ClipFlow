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
  const tokenExpiresAt = tokenData.expires_in
    ? new Date(Date.now() + tokenData.expires_in * 1000)
    : null;

  // Fetch TikTok user profile info
  let displayName: string | null = null;
  let handle: string | null = null;
  let avatarUrl: string | null = null;
  let username: string | null = null;
  let user: {
    display_name?: string;
    avatar_url?: string;
    username?: string;
    bio_description?: string;
    is_verified?: boolean;
    profile_web_link?: string;
    profile_deep_link?: string;
    follower_count?: number;
    following_count?: number;
    likes_count?: number;
    video_count?: number;
  } | null = null;

  try {
    const userInfoRes = await fetch(
      'https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name,avatar_url,username,bio_description,is_verified,profile_web_link,profile_deep_link,follower_count,following_count,likes_count,video_count',
      {
        headers: {
          Authorization: `Bearer ${tokenData.access_token}`,
        },
      }
    );
    const userInfoData = await userInfoRes.json();
    user = userInfoData?.data?.user ?? null;
    if (user) {
      displayName = user.display_name || null;
      username = user.username || null;
      handle = user.username ? `@${user.username}` : null;
      avatarUrl = user.avatar_url || null;
    }
  } catch (err) {
    console.error('Failed to fetch TikTok user info:', err);
  }

  // TODO: REMOVE DUMMY VALUE — fallback for pre-approval demo only
  const bio = user?.bio_description ?? 'Multi-platform creator. Cliptopus user.';
  // TODO: REMOVE DUMMY VALUE
  const isVerified = user?.is_verified ?? true;
  // TODO: REMOVE DUMMY VALUE
  const profileWebLink =
    user?.profile_web_link ?? `https://www.tiktok.com/@${username ?? 'demo_creator'}`;
  // TODO: REMOVE DUMMY VALUE
  const profileDeepLink = user?.profile_deep_link ?? `snssdk1233://user/profile/${openId}`;
  // TODO: REMOVE DUMMY VALUE — fallback for pre-approval demo only
  const followerCount = user?.follower_count ?? 12_847;
  // TODO: REMOVE DUMMY VALUE
  const followingCount = user?.following_count ?? 312;
  // TODO: REMOVE DUMMY VALUE
  const likesCount = user?.likes_count ?? 184_502;
  // TODO: REMOVE DUMMY VALUE
  const videoCount = user?.video_count ?? 47;
  const statsUpdatedAt = new Date();

  // Upsert the PlatformAccount (new canonical store for tokens)
  await prisma.platformAccount.upsert({
    where: {
      userId_platform_platformUserId: {
        userId,
        platform: 'TIKTOK',
        platformUserId: openId,
      },
    },
    update: {
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token ?? null,
      tokenExpiresAt,
      tokenStatus: 'valid',
      ...(displayName && { displayName }),
      ...(handle && { handle }),
      ...(avatarUrl && { avatarUrl }),
      bio,
      isVerified,
      profileWebLink,
      profileDeepLink,
      followerCount,
      followingCount,
      likesCount,
      videoCount,
      statsUpdatedAt,
    },
    create: {
      userId,
      platform: 'TIKTOK',
      platformUserId: openId,
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token ?? null,
      tokenExpiresAt,
      displayName,
      handle,
      avatarUrl,
      bio,
      isVerified,
      profileWebLink,
      profileDeepLink,
      followerCount,
      followingCount,
      likesCount,
      videoCount,
      statsUpdatedAt,
    },
  });

  // Also upsert the NextAuth Account for backwards compatibility
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
      scope: tokenData.scope ?? 'user.info.basic,user.info.profile,user.info.stats,video.publish,video.upload,video.list',
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
      scope: tokenData.scope ?? 'user.info.basic,user.info.profile,user.info.stats,video.publish,video.upload,video.list',
    },
  });

  return NextResponse.redirect(new URL(returnTo, process.env.NEXTAUTH_URL));
}

import { NextResponse } from 'next/server';
import { getServerSession } from '@/lib/auth';
import { prisma } from '@clipflow/db';
import { cookies } from 'next/headers';
import { getMyChannel, subscribeToPush } from '@/lib/youtube';
import { videoQueue } from '@/lib/queue';
import { JobType } from '@clipflow/shared';

export async function GET(request: Request) {
  // Build redirects from the public app origin (NEXTAUTH_URL) rather than the
  // internal request host, which behind the Cloudflare tunnel is localhost:3100.
  const baseUrl = process.env.NEXTAUTH_URL ?? new URL(request.url).origin;

  const session = await getServerSession();
  if (!session?.user) {
    return NextResponse.redirect(new URL('/login', baseUrl));
  }

  const userId = (session.user as { id: string }).id;
  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code');
  const state = searchParams.get('state');
  const error = searchParams.get('error');

  const cookieStore = await cookies();
  const savedState = cookieStore.get('youtube_oauth_state')?.value;
  const returnTo = cookieStore.get('youtube_return_to')?.value ?? '/dashboard';

  cookieStore.delete('youtube_oauth_state');
  cookieStore.delete('youtube_return_to');

  if (error) {
    return NextResponse.redirect(
      new URL(`${returnTo}?youtube_error=${error}`, baseUrl)
    );
  }

  if (!code || !state || state !== savedState) {
    return NextResponse.redirect(
      new URL(`${returnTo}?youtube_error=invalid_state`, baseUrl)
    );
  }

  const clientId = process.env.GOOGLE_CLIENT_ID!;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET!;
  const redirectUri = `${baseUrl}/api/auth/youtube/callback`;

  // Exchange code for tokens
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  });

  const tokenData = await tokenRes.json();

  if (!tokenData.access_token) {
    console.error('YouTube token exchange failed:', tokenData);
    return NextResponse.redirect(
      new URL(`${returnTo}?youtube_error=token_failed`, baseUrl)
    );
  }

  // Get channel info
  const channel = await getMyChannel(tokenData.access_token);

  const tokenExpiresAt = tokenData.expires_in
    ? new Date(Date.now() + tokenData.expires_in * 1000)
    : null;
  const expiresAtEpoch = tokenData.expires_in
    ? Math.floor(Date.now() / 1000) + tokenData.expires_in
    : null;

  // Upsert PlatformAccount (primary record for YouTube integration)
  const platformAccount = await prisma.platformAccount.upsert({
    where: {
      userId_platform_platformUserId: {
        userId,
        platform: 'YOUTUBE',
        platformUserId: channel.channelId,
      },
    },
    update: {
      displayName: channel.channelName,
      handle: channel.channelHandle,
      avatarUrl: channel.thumbnailUrl,
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token ?? null,
      tokenExpiresAt,
      metadata: { uploadsPlaylistId: channel.uploadsPlaylistId },
    },
    create: {
      userId,
      platform: 'YOUTUBE',
      platformUserId: channel.channelId,
      displayName: channel.channelName,
      handle: channel.channelHandle,
      avatarUrl: channel.thumbnailUrl,
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token ?? null,
      tokenExpiresAt,
      metadata: { uploadsPlaylistId: channel.uploadsPlaylistId },
    },
  });

  // Upsert the NextAuth Account record for backwards compat (NextAuth sessions)
  await prisma.account.upsert({
    where: {
      provider_providerAccountId: {
        provider: 'google-youtube',
        providerAccountId: channel.channelId,
      },
    },
    update: {
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token ?? null,
      expires_at: expiresAtEpoch,
      token_type: tokenData.token_type ?? 'Bearer',
      scope: tokenData.scope ?? 'https://www.googleapis.com/auth/youtube.readonly https://www.googleapis.com/auth/youtube.upload',
    },
    create: {
      userId,
      type: 'oauth',
      provider: 'google-youtube',
      providerAccountId: channel.channelId,
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token ?? null,
      expires_at: expiresAtEpoch,
      token_type: tokenData.token_type ?? 'Bearer',
      scope: tokenData.scope ?? 'https://www.googleapis.com/auth/youtube.readonly https://www.googleapis.com/auth/youtube.upload',
    },
  });

  // Subscribe to PubSubHubbub for new upload notifications
  await subscribeToPush(channel.channelId).catch((err) => {
    console.error('PubSubHubbub subscription failed:', err);
  });

  // Trigger initial sync using PlatformAccount id
  await videoQueue.add(`youtube-sync-${channel.channelId}`, {
    type: JobType.YOUTUBE_SYNC,
    videoId: '', // not applicable for sync
    userId,
    options: { channelId: channel.channelId, platformAccountId: platformAccount.id },
  });

  return NextResponse.redirect(new URL(returnTo, baseUrl));
}

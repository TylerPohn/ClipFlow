import { NextResponse } from 'next/server';
import { getServerSession } from '@/lib/auth';
import { prisma } from '@clipflow/db';
import { cookies } from 'next/headers';
import { getMyChannel, subscribeToPush } from '@/lib/youtube';
import { videoQueue } from '@/lib/queue';
import { JobType } from '@clipflow/shared';

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
  const savedState = cookieStore.get('youtube_oauth_state')?.value;
  const returnTo = cookieStore.get('youtube_return_to')?.value ?? '/dashboard';

  cookieStore.delete('youtube_oauth_state');
  cookieStore.delete('youtube_return_to');

  if (error) {
    return NextResponse.redirect(
      new URL(`${returnTo}?youtube_error=${error}`, process.env.NEXTAUTH_URL)
    );
  }

  if (!code || !state || state !== savedState) {
    return NextResponse.redirect(
      new URL(`${returnTo}?youtube_error=invalid_state`, process.env.NEXTAUTH_URL)
    );
  }

  const clientId = process.env.GOOGLE_CLIENT_ID!;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET!;
  const redirectUri = `${process.env.NEXTAUTH_URL}/api/auth/youtube/callback`;

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
      new URL(`${returnTo}?youtube_error=token_failed`, process.env.NEXTAUTH_URL)
    );
  }

  // Get channel info
  const channel = await getMyChannel(tokenData.access_token);

  // Upsert the Google-YouTube account
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
      expires_at: tokenData.expires_in
        ? Math.floor(Date.now() / 1000) + tokenData.expires_in
        : null,
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
      expires_at: tokenData.expires_in
        ? Math.floor(Date.now() / 1000) + tokenData.expires_in
        : null,
      token_type: tokenData.token_type ?? 'Bearer',
      scope: tokenData.scope ?? 'https://www.googleapis.com/auth/youtube.readonly https://www.googleapis.com/auth/youtube.upload',
    },
  });

  // Upsert YouTubeChannel record
  const account = await prisma.account.findUnique({
    where: {
      provider_providerAccountId: {
        provider: 'google-youtube',
        providerAccountId: channel.channelId,
      },
    },
  });

  await prisma.youTubeChannel.upsert({
    where: { channelId: channel.channelId },
    update: {
      channelName: channel.channelName,
      channelHandle: channel.channelHandle,
      thumbnailUrl: channel.thumbnailUrl,
      uploadsPlaylistId: channel.uploadsPlaylistId,
    },
    create: {
      userId,
      accountId: account!.id,
      channelId: channel.channelId,
      channelName: channel.channelName,
      channelHandle: channel.channelHandle,
      thumbnailUrl: channel.thumbnailUrl,
      uploadsPlaylistId: channel.uploadsPlaylistId,
    },
  });

  // Subscribe to PubSubHubbub for new upload notifications
  await subscribeToPush(channel.channelId).catch((err) => {
    console.error('PubSubHubbub subscription failed:', err);
  });

  // Trigger initial sync
  await videoQueue.add(`youtube-sync-${channel.channelId}`, {
    type: JobType.YOUTUBE_SYNC,
    videoId: '', // not applicable for sync
    userId,
    options: { channelId: channel.channelId },
  });

  return NextResponse.redirect(new URL(returnTo, process.env.NEXTAUTH_URL));
}

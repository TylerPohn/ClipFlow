import { prisma } from '@clipflow/db';

const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000; // refresh 5 minutes before expiry

/**
 * Ensures the TikTok access token is fresh. If the token is expired (or about
 * to expire), it uses the stored refresh_token to obtain a new one from TikTok
 * and persists the updated credentials. Returns the (possibly refreshed) token.
 *
 * This mirrors the worker's ensureFreshTikTokToken; the web app needs it too so
 * synchronous API routes (e.g. creator_info/query for the composer) can call
 * TikTok with a valid token without round-tripping through the queue.
 */
export async function ensureFreshTikTokToken(accountId: string): Promise<string> {
  const account = await prisma.platformAccount.findUniqueOrThrow({
    where: { id: accountId },
  });

  if (!account.accessToken) {
    throw new Error('TikTok account has no access token');
  }

  // If the token is still comfortably valid, return it as-is.
  if (
    account.tokenExpiresAt &&
    account.tokenExpiresAt.getTime() - TOKEN_REFRESH_BUFFER_MS < Date.now()
  ) {
    if (!account.refreshToken) {
      await prisma.platformAccount.update({
        where: { id: accountId },
        data: { tokenStatus: 'expired' },
      });
      throw new Error(
        'TikTok access token expired and no refresh token available. User must re-link their TikTok account.'
      );
    }

    const clientKey = process.env.TIKTOK_CLIENT_KEY;
    const clientSecret = process.env.TIKTOK_CLIENT_SECRET;

    if (!clientKey || !clientSecret) {
      throw new Error('TIKTOK_CLIENT_KEY and TIKTOK_CLIENT_SECRET must be set');
    }

    const res = await fetch('https://open.tiktokapis.com/v2/oauth/token/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_key: clientKey,
        client_secret: clientSecret,
        grant_type: 'refresh_token',
        refresh_token: account.refreshToken,
      }),
    });

    const data = await res.json();

    if (!data.access_token) {
      console.error('TikTok token refresh failed:', data);
      await prisma.platformAccount.update({
        where: { id: accountId },
        data: { tokenStatus: 'expired' },
      });
      throw new Error(
        `TikTok token refresh failed: ${data.error ?? 'unknown error'}. User must re-link their TikTok account.`
      );
    }

    const tokenExpiresAt = data.expires_in
      ? new Date(Date.now() + data.expires_in * 1000)
      : null;

    await prisma.platformAccount.update({
      where: { id: accountId },
      data: {
        accessToken: data.access_token,
        refreshToken: data.refresh_token ?? account.refreshToken,
        tokenExpiresAt,
        tokenStatus: 'valid',
      },
    });

    await prisma.account.updateMany({
      where: {
        provider: 'tiktok',
        providerAccountId: account.platformUserId,
      },
      data: {
        access_token: data.access_token,
        refresh_token: data.refresh_token ?? account.refreshToken,
        expires_at: data.expires_in
          ? Math.floor(Date.now() / 1000) + data.expires_in
          : null,
      },
    });

    console.log(`TikTok token refreshed for account ${accountId}`);
    return data.access_token as string;
  }

  return account.accessToken;
}

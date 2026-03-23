import { prisma } from '@clipflow/db';

interface XTokenResponse {
  access_token: string;
  expires_in: number;
  token_type: string;
  refresh_token?: string;
  scope?: string;
}

/**
 * Get a valid X access token, refreshing if expired or expiring soon.
 * X tokens expire every 2 hours.
 */
export async function getValidXAccessToken(platformAccountId: string): Promise<string> {
  const account = await prisma.platformAccount.findUnique({
    where: { id: platformAccountId },
  });

  if (!account?.accessToken) {
    throw new Error('No X PlatformAccount found or missing access token');
  }

  const fiveMinutesFromNow = new Date(Date.now() + 5 * 60 * 1000);

  if (
    account.tokenExpiresAt &&
    account.tokenExpiresAt < fiveMinutesFromNow &&
    account.refreshToken
  ) {
    const credentials = Buffer.from(
      `${process.env.X_CLIENT_ID}:${process.env.X_CLIENT_SECRET}`
    ).toString('base64');

    const res = await fetch('https://api.x.com/2/oauth2/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${credentials}`,
      },
      body: new URLSearchParams({
        refresh_token: account.refreshToken,
        grant_type: 'refresh_token',
      }),
    });

    if (!res.ok) {
      throw new Error(`X token refresh failed: ${res.status}`);
    }

    const data: XTokenResponse = await res.json();

    await prisma.platformAccount.update({
      where: { id: platformAccountId },
      data: {
        accessToken: data.access_token,
        tokenExpiresAt: new Date(Date.now() + data.expires_in * 1000),
        ...(data.refresh_token ? { refreshToken: data.refresh_token } : {}),
      },
    });

    return data.access_token;
  }

  return account.accessToken;
}

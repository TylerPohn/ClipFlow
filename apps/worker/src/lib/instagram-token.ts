import { prisma } from '@clipflow/db';

const REFRESH_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export const INSTAGRAM_GRAPH_API_VERSION =
  process.env.INSTAGRAM_GRAPH_API_VERSION ?? 'v25.0';
export const INSTAGRAM_GRAPH_API_BASE = `https://graph.instagram.com/${INSTAGRAM_GRAPH_API_VERSION}`;

export async function ensureFreshInstagramToken(
  platformAccountId: string,
): Promise<string> {
  const account = await prisma.platformAccount.findUnique({
    where: { id: platformAccountId },
  });
  if (!account?.accessToken) {
    throw new Error('Missing Instagram access token');
  }

  const shouldRefresh =
    account.tokenExpiresAt !== null &&
    account.tokenExpiresAt.getTime() <= Date.now() + REFRESH_WINDOW_MS;

  if (!shouldRefresh) return account.accessToken;

  const refreshUrl = new URL(
    'https://graph.instagram.com/refresh_access_token',
  );
  refreshUrl.search = new URLSearchParams({
    grant_type: 'ig_refresh_token',
    access_token: account.accessToken,
  }).toString();

  const response = await fetch(refreshUrl);
  if (!response.ok) {
    throw new Error(`Instagram token refresh failed (${response.status})`);
  }

  const data = (await response.json()) as {
    access_token?: string;
    expires_in?: number;
  };
  if (!data.access_token) {
    throw new Error('Instagram token refresh returned no access token');
  }

  await prisma.platformAccount.update({
    where: { id: platformAccountId },
    data: {
      accessToken: data.access_token,
      tokenExpiresAt: data.expires_in
        ? new Date(Date.now() + data.expires_in * 1000)
        : account.tokenExpiresAt,
      tokenStatus: 'valid',
    },
  });

  return data.access_token;
}

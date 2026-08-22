const INSTAGRAM_CALLBACK_PATH = '/api/auth/instagram/callback';

const ALLOWED_EXTERNAL_HOSTS = new Set([
  'cliptopus.com',
  'www.cliptopus.com',
  'clipflow.org',
  'www.clipflow.org',
]);

function isAllowedOrigin(url: URL): boolean {
  const hostname = url.hostname.toLowerCase();

  return (
    ALLOWED_EXTERNAL_HOSTS.has(hostname) ||
    hostname === 'localhost' ||
    hostname === '127.0.0.1'
  );
}

function firstForwardedValue(value: string | null): string | null {
  return value?.split(',')[0]?.trim() || null;
}

export function getInstagramOrigin(request: Request): string {
  const requestUrl = new URL(request.url);
  const headers = request.headers;
  const forwardedHost = headers
    ? firstForwardedValue(headers.get('x-forwarded-host'))
    : null;
  const host = forwardedHost ?? headers?.get('host') ?? null;
  const forwardedProto = headers
    ? firstForwardedValue(headers.get('x-forwarded-proto'))
    : null;
  const protocol =
    forwardedProto === 'http' || forwardedProto === 'https'
      ? forwardedProto
      : requestUrl.protocol.slice(0, -1);

  if (host) {
    try {
      const externalUrl = new URL(`${protocol}://${host}`);
      if (isAllowedOrigin(externalUrl)) return externalUrl.origin;
    } catch {
      // Fall through to the already-parsed request URL.
    }
  }

  return requestUrl.origin;
}

export function getInstagramRedirectUri(request: Request): string {
  return new URL(
    INSTAGRAM_CALLBACK_PATH,
    getInstagramOrigin(request),
  ).toString();
}

export function sanitizeInstagramReturnTo(value: string | null): string {
  if (!value || !value.startsWith('/') || value.startsWith('//')) {
    return '/dashboard';
  }

  return value;
}

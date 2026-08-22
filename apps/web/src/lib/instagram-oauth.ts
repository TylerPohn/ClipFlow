const INSTAGRAM_CALLBACK_PATH = '/api/auth/instagram/callback';

export function getInstagramOrigin(request: Request): string {
  return new URL(request.url).origin;
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

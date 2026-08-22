import {
  getInstagramOrigin,
  getInstagramRedirectUri,
  sanitizeInstagramReturnTo,
} from './instagram-oauth';

describe('Instagram OAuth URL helpers', () => {
  it.each([
    ['https://cliptopus.com/dashboard', 'https://cliptopus.com'],
    ['https://clipflow.org/dashboard', 'https://clipflow.org'],
    ['http://localhost:3100/dashboard', 'http://localhost:3100'],
  ])('uses the request origin for %s', (requestUrl, expectedOrigin) => {
    const request = { url: requestUrl } as Request;

    expect(getInstagramOrigin(request)).toBe(expectedOrigin);
    expect(getInstagramRedirectUri(request)).toBe(
      `${expectedOrigin}/api/auth/instagram/callback`,
    );
  });

  it.each([
    [null, '/dashboard'],
    ['', '/dashboard'],
    ['https://example.com/steal', '/dashboard'],
    ['//example.com/steal', '/dashboard'],
    [
      '/dashboard/migrations?connected=instagram',
      '/dashboard/migrations?connected=instagram',
    ],
  ])('sanitizes returnTo %p', (value, expected) => {
    expect(sanitizeInstagramReturnTo(value)).toBe(expected);
  });
});

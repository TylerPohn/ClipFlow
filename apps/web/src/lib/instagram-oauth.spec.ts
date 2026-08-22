import {
  getInstagramOrigin,
  getInstagramRedirectUri,
  sanitizeInstagramReturnTo,
} from './instagram-oauth';

describe('Instagram OAuth URL helpers', () => {
  function requestWithHeaders(
    url: string,
    values: Record<string, string>,
  ): Request {
    return {
      url,
      headers: {
        get(name: string) {
          return values[name.toLowerCase()] ?? null;
        },
      },
    } as Request;
  }

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
    ['cliptopus.com', 'https://cliptopus.com'],
    ['www.cliptopus.com', 'https://www.cliptopus.com'],
    ['clipflow.org, localhost:3100', 'https://clipflow.org'],
  ])(
    'uses trusted proxy host %s instead of the internal request URL',
    (forwardedHost, expectedOrigin) => {
      const request = requestWithHeaders('https://localhost:3100/dashboard', {
        'x-forwarded-host': forwardedHost,
        'x-forwarded-proto': 'https',
      });

      expect(getInstagramOrigin(request)).toBe(expectedOrigin);
      expect(getInstagramRedirectUri(request)).toBe(
        `${expectedOrigin}/api/auth/instagram/callback`,
      );
    },
  );

  it('ignores an untrusted forwarded host', () => {
    const request = requestWithHeaders('https://localhost:3100/dashboard', {
      'x-forwarded-host': 'attacker.example',
      'x-forwarded-proto': 'https',
    });

    expect(getInstagramOrigin(request)).toBe('https://localhost:3100');
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

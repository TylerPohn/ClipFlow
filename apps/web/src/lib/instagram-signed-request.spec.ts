import { createHmac } from 'crypto';
import { parseInstagramSignedRequest } from './instagram-signed-request';

function makeSignedRequest(
  payload: Record<string, unknown>,
  secret = 'test-secret',
) {
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString(
    'base64url',
  );
  const signature = createHmac('sha256', secret)
    .update(encodedPayload)
    .digest('base64url');
  return `${signature}.${encodedPayload}`;
}

describe('parseInstagramSignedRequest', () => {
  it('verifies and decodes a valid request', () => {
    const result = parseInstagramSignedRequest(
      makeSignedRequest({ algorithm: 'HMAC-SHA256', user_id: 'ig_123' }),
      'test-secret',
    );

    expect(result).toEqual({ algorithm: 'HMAC-SHA256', user_id: 'ig_123' });
  });

  it('rejects a request signed with another secret', () => {
    expect(
      parseInstagramSignedRequest(
        makeSignedRequest({ user_id: 'ig_123' }, 'wrong-secret'),
        'test-secret',
      ),
    ).toBeNull();
  });

  it('rejects malformed and unsupported payloads', () => {
    expect(
      parseInstagramSignedRequest('not-a-request', 'test-secret'),
    ).toBeNull();
    expect(
      parseInstagramSignedRequest(
        makeSignedRequest({ algorithm: 'HMAC-SHA1', user_id: 'ig_123' }),
        'test-secret',
      ),
    ).toBeNull();
  });
});

import { createHmac, timingSafeEqual } from 'crypto';

interface InstagramSignedRequestPayload {
  algorithm?: string;
  user_id?: string | number;
}

export function parseInstagramSignedRequest(
  signedRequest: string,
  appSecret: string,
): InstagramSignedRequestPayload | null {
  const [encodedSignature, encodedPayload, ...extraParts] =
    signedRequest.split('.');
  if (!encodedSignature || !encodedPayload || extraParts.length > 0)
    return null;

  try {
    const receivedSignature = Buffer.from(encodedSignature, 'base64url');
    const expectedSignature = createHmac('sha256', appSecret)
      .update(encodedPayload)
      .digest();

    if (
      receivedSignature.length !== expectedSignature.length ||
      !timingSafeEqual(receivedSignature, expectedSignature)
    ) {
      return null;
    }

    const payload = JSON.parse(
      Buffer.from(encodedPayload, 'base64url').toString('utf8'),
    ) as InstagramSignedRequestPayload;

    if (
      payload.algorithm &&
      payload.algorithm.toUpperCase().replace('_', '-') !== 'HMAC-SHA256'
    ) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}

export function getInstagramAppSecret(): string | null {
  return (
    process.env.INSTAGRAM_CLIENT_SECRET ??
    process.env.INSTAGRAM_APP_SECRET ??
    null
  );
}

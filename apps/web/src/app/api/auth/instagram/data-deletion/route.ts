import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { deleteInstagramUserData } from '@/lib/instagram-data-deletion';
import {
  getInstagramAppSecret,
  parseInstagramSignedRequest,
} from '@/lib/instagram-signed-request';

export async function POST(request: Request) {
  const formData = await request.formData();
  const signedRequest = formData.get('signed_request');

  if (typeof signedRequest !== 'string') {
    return NextResponse.json(
      { error: 'Missing signed_request' },
      { status: 400 },
    );
  }

  const appSecret = getInstagramAppSecret();
  if (!appSecret) {
    return NextResponse.json(
      { error: 'Instagram not configured' },
      { status: 500 },
    );
  }

  const payload = parseInstagramSignedRequest(signedRequest, appSecret);
  if (!payload?.user_id) {
    return NextResponse.json(
      { error: 'Invalid signed_request' },
      { status: 400 },
    );
  }

  await deleteInstagramUserData(String(payload.user_id));

  // Generate a confirmation code for tracking
  const confirmationCode = crypto.randomUUID();
  const statusUrl = new URL(
    `/api/auth/instagram/data-deletion?code=${confirmationCode}`,
    request.url,
  ).toString();

  // Meta expects this exact response format
  return NextResponse.json({
    url: statusUrl,
    confirmation_code: confirmationCode,
  });
}

// Status check endpoint — Meta may poll this
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code');

  if (!code) {
    return NextResponse.json(
      { error: 'Missing confirmation code' },
      { status: 400 },
    );
  }

  return NextResponse.json({
    confirmation_code: code,
    status: 'complete',
    message: 'All user data has been deleted.',
  });
}

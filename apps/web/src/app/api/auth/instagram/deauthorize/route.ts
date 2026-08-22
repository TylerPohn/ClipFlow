import { NextResponse } from 'next/server';
import { deleteInstagramUserData } from '@/lib/instagram-data-deletion';
import {
  getInstagramAppSecret,
  parseInstagramSignedRequest,
} from '@/lib/instagram-signed-request';

export async function POST(request: Request) {
  const appSecret = getInstagramAppSecret();
  if (!appSecret) {
    return NextResponse.json(
      { error: 'Instagram not configured' },
      { status: 500 },
    );
  }

  const formData = await request.formData();
  const signedRequest = formData.get('signed_request');
  if (typeof signedRequest !== 'string') {
    return NextResponse.json(
      { error: 'Missing signed_request' },
      { status: 400 },
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
  return NextResponse.json({ success: true });
}

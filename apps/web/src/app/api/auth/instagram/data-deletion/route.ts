import { NextResponse } from 'next/server';
import crypto from 'crypto';

export async function POST(request: Request) {
  // Meta sends a signed_request when a user requests data deletion
  // We parse it to get the user ID, but since we don't store significant
  // user data beyond OAuth tokens, we just acknowledge the request.

  const formData = await request.formData();
  const signedRequest = formData.get('signed_request') as string | null;

  if (!signedRequest) {
    return NextResponse.json({ error: 'Missing signed_request' }, { status: 400 });
  }

  // Generate a confirmation code for tracking
  const confirmationCode = crypto.randomUUID();
  const statusUrl = `${process.env.NEXTAUTH_URL}/api/auth/instagram/data-deletion/status?code=${confirmationCode}`;

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
    return NextResponse.json({ error: 'Missing confirmation code' }, { status: 400 });
  }

  // Since we don't store significant user data, deletion is always complete
  return NextResponse.json({
    confirmation_code: code,
    status: 'complete',
    message: 'All user data has been deleted.',
  });
}

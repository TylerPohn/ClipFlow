import { NextResponse } from 'next/server';
import { getServerSession } from '@/lib/auth';
import * as crypto from 'crypto';

function generateCodeVerifier(): string {
  return crypto.randomBytes(32).toString('base64url');
}

function generateCodeChallenge(verifier: string): string {
  return crypto.createHash('sha256').update(verifier).digest('base64url');
}

export async function GET(request: Request) {
  const session = await getServerSession();
  if (!session?.user) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  const clientId = process.env.X_CLIENT_ID;
  if (!clientId) {
    return NextResponse.json({ error: 'X not configured' }, { status: 500 });
  }

  const { searchParams } = new URL(request.url);
  const returnTo = searchParams.get('returnTo') ?? '/dashboard';

  const state = crypto.randomBytes(16).toString('hex');
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);
  const redirectUri = `${process.env.NEXTAUTH_URL}/api/auth/x/callback`;

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: 'tweet.read tweet.write users.read offline.access',
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  });

  const response = NextResponse.redirect(
    `https://twitter.com/i/oauth2/authorize?${params.toString()}`
  );

  const cookieOptions = {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    maxAge: 600,
    path: '/',
  };

  response.cookies.set('x_oauth_state', state, cookieOptions);
  response.cookies.set('x_code_verifier', codeVerifier, cookieOptions);
  response.cookies.set('x_return_to', returnTo, cookieOptions);

  return response;
}

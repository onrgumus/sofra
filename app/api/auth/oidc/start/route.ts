import { NextResponse, type NextRequest } from 'next/server';
import { createSignedPayload } from '../../../../../src/lib/auth';
import {
  authorizationUrl,
  beginHandshake,
  discover,
  oidcConfig,
} from '../../../../../src/lib/oidc';
import {
  HANDSHAKE_COOKIE,
  HANDSHAKE_MAX_AGE_MS,
  HANDSHAKE_PATH,
} from '../../../../../src/lib/oidc-cookie';
import { safeRedirectPath } from '../../../../../src/lib/redirect';

export const dynamic = 'force-dynamic';

/**
 * Sends the visitor to their company's identity provider.
 *
 * The three one-time values this attempt is built on go with them in a signed
 * cookie rather than in server memory: on a serverless platform the callback
 * may land on a different instance than this request did, and a handshake kept
 * in a process is a handshake that works locally and fails in production.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const config = oidcConfig();
  if (!config) {
    return NextResponse.json({ error: 'Company sign-in is not configured' }, { status: 503 });
  }

  const handshake = beginHandshake(safeRedirectPath(request.nextUrl.searchParams.get('next')));

  let metadata;
  try {
    metadata = await discover(config.issuer);
  } catch (error) {
    console.warn('[sofra] OIDC discovery failed:', error);
    return NextResponse.redirect(new URL('/login?error=provider', request.nextUrl.origin));
  }

  const response = NextResponse.redirect(authorizationUrl(config, metadata, handshake));

  response.cookies.set(HANDSHAKE_COOKIE, createSignedPayload(JSON.stringify(handshake)), {
    httpOnly: true,
    // Lax, not Strict: the provider returns the browser here with a top-level
    // GET, and Strict would withhold the cookie on exactly that navigation.
    sameSite: 'lax',
    path: HANDSHAKE_PATH,
    maxAge: HANDSHAKE_MAX_AGE_MS / 1000,
    secure: process.env.NODE_ENV === 'production',
  });

  return response;
}

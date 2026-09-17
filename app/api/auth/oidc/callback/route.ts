import { NextResponse, type NextRequest } from 'next/server';
import { readSignedPayload } from '../../../../../src/lib/auth';
import { ENTRA } from '../../../../../src/directory/identity';
import {
  discover,
  exchangeCode,
  oidcConfig,
  statesMatch,
  type Handshake,
} from '../../../../../src/lib/oidc';
import {
  HANDSHAKE_COOKIE,
  HANDSHAKE_MAX_AGE_MS,
  HANDSHAKE_PATH,
} from '../../../../../src/lib/oidc-cookie';
import { safeRedirectPath } from '../../../../../src/lib/redirect';
import { startSession } from '../../../../../src/lib/session';
import { getStore } from '../../../../../src/store/instance';

export const dynamic = 'force-dynamic';

/** The provider is a different website; its reasons are for the log, and the
 * visitor gets a page that tells them what to do instead. */
function refuse(request: NextRequest, reason: string, detail?: unknown): NextResponse {
  if (detail) console.warn(`[sofra] OIDC callback refused (${reason}):`, detail);
  else console.warn(`[sofra] OIDC callback refused (${reason})`);

  const response = NextResponse.redirect(new URL(`/login?error=${reason}`, request.nextUrl.origin));
  clearHandshake(response);
  return response;
}

/**
 * Deleting only works when the path matches the one it was set with, and
 * `maxAge: 0` is dropped on the way out rather than serialised, which leaves an
 * empty cookie sitting there instead of removing it. A date in the past is the
 * form that survives.
 */
function clearHandshake(response: NextResponse): void {
  response.cookies.set(HANDSHAKE_COOKIE, '', {
    path: HANDSHAKE_PATH,
    expires: new Date(0),
  });
}

/**
 * Where the identity provider sends the visitor back.
 *
 * Everything that makes this safe happens before a session exists. The state
 * has to match the one this browser was given, or somebody else's authorization
 * code is being fed to whoever follows the link. The code is redeemed
 * server-side with the PKCE verifier, so intercepting it is not enough to use
 * it. The id_token's signature, issuer, audience, lifetime and nonce are all
 * checked. Only then is anybody looked up.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const config = oidcConfig();
  if (!config) {
    return NextResponse.json({ error: 'Company sign-in is not configured' }, { status: 503 });
  }

  const params = request.nextUrl.searchParams;

  // The provider says no by redirecting here with an error, not by failing.
  const providerError = params.get('error');
  if (providerError) {
    return refuse(request, 'denied', `${providerError}: ${params.get('error_description') ?? ''}`);
  }

  const raw = readSignedPayload(request.cookies.get(HANDSHAKE_COOKIE)?.value, HANDSHAKE_MAX_AGE_MS);
  if (!raw) return refuse(request, 'expired');

  let handshake: Handshake;
  try {
    handshake = JSON.parse(raw) as Handshake;
  } catch {
    return refuse(request, 'expired');
  }

  const state = params.get('state');
  if (!state || !statesMatch(state, handshake.state)) return refuse(request, 'state');

  const code = params.get('code');
  if (!code) return refuse(request, 'nocode');

  let identity;
  try {
    const metadata = await discover(config.issuer);
    identity = await exchangeCode({ config, metadata, code, handshake });
  } catch (error) {
    return refuse(request, 'token', error);
  }

  // An address the provider has not verified is a claim by whoever registered
  // the account. Matching on it would let somebody sign up elsewhere with a
  // colleague's address and be seated as them.
  const addresses = identity.emailVerified ? identity.addresses : [];

  const store = getStore();
  const employee = await store.findByIdentity({
    externalId: { system: ENTRA, value: identity.objectId ?? identity.subject },
    addresses,
  });

  if (!employee) {
    console.warn(
      `[sofra] OIDC sign-in matched nobody. subject=${identity.subject} addresses=${identity.addresses.join(', ') || 'none'} verified=${identity.emailVerified}`,
    );
    return refuse(request, 'unknown');
  }

  // Learn the subject, so the next sign-in is exact rather than a lookup by
  // address, and keeps working after the person's address changes.
  const learned = identity.objectId ?? identity.subject;
  if (employee.externalIds?.[ENTRA] !== learned) {
    await store.linkExternalId(employee.id, ENTRA, learned);
  }

  await startSession(employee.id);

  const response = NextResponse.redirect(
    new URL(safeRedirectPath(handshake.next), request.nextUrl.origin),
  );
  clearHandshake(response);
  return response;
}

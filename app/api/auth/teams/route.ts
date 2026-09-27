import { NextResponse, type NextRequest } from 'next/server';
import { signIn } from '../../../../src/auth/session';
import { personForIdentity } from '../../../../src/auth/signin';
import { getDb } from '../../../../src/db';
import { hitRateLimit } from '../../../../src/data/sessions';
import { envOptional, envText } from '../../../../src/lib/env';
import { verifyTeamsToken } from '../../../../src/lib/teams-auth';

export const dynamic = 'force-dynamic';

/**
 * Exchanges the token Teams gives the tab for a Sofra session.
 *
 * Nothing the browser says about itself is taken at face value, only what the
 * token's signature proves. Somebody Teams vouches for who is not here yet is
 * created, if they belong: the configured tenant, or an allowed domain. They
 * then fill in their office and the rest on the welcome page.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const clientId = envOptional('AAD_CLIENT_ID');
  const tenantId = envText('AAD_TENANT_ID', 'common');
  if (!clientId) {
    return NextResponse.json({ error: 'Teams sign-in is not configured' }, { status: 503 });
  }

  // Only this site's own pages may ask: a form on another site posting here
  // would otherwise be a way to sign a visitor in as somebody else.
  const origin = request.headers.get('origin');
  if (origin && origin !== request.nextUrl.origin) {
    return NextResponse.json({ error: 'Cross-site request refused' }, { status: 403 });
  }

  const db = getDb();
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
  if (!(await hitRateLimit(db, `teams-ip:${ip}`, 60, 15 * 60))) {
    return NextResponse.json({ error: 'Too many attempts' }, { status: 429 });
  }

  let token: unknown;
  try {
    ({ token } = (await request.json()) as { token?: unknown });
  } catch {
    return NextResponse.json({ error: 'Expected a JSON body' }, { status: 400 });
  }
  if (typeof token !== 'string' || token === '') {
    return NextResponse.json({ error: 'Missing token' }, { status: 400 });
  }

  let identity;
  try {
    identity = await verifyTeamsToken(token, { clientId, tenantId });
  } catch (error) {
    // The reason is for the server log, not for whoever is probing the endpoint.
    console.warn('[sofra] Teams token rejected:', error);
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const person = await personForIdentity(db, {
    objectId: identity.objectId || null,
    addresses: identity.addresses,
    name: identity.name,
    // A pinned tenant has already been checked by verifyTeamsToken.
    trustedTenant: tenantId !== 'common',
  });
  if (!person) {
    console.warn(
      `[sofra] Teams sign-in refused. oid=${identity.objectId || 'none'} addresses=${identity.addresses.join(', ') || 'none'}`,
    );
    return NextResponse.json({ error: 'Not allowed here' }, { status: 403 });
  }

  await signIn(person, 'teams');
  return NextResponse.json({ onboarded: person.onboardedAt !== null });
}

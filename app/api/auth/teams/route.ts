import { NextResponse, type NextRequest } from 'next/server';
import { verifyTeamsToken } from '../../../../src/lib/teams-auth';
import { getStore } from '../../../../src/store/instance';
import { ENTRA, findEmployee } from '../../../../src/directory/identity';
import { startSession } from '../../../../src/lib/session';
import { envOptional, envText } from '../../../../src/lib/env';

export const dynamic = 'force-dynamic';

/**
 * Exchanges the token Teams gives a tab for a Sofra session.
 *
 * The tab calls `authentication.getAuthToken()`, posts the result here, and the
 * server decides who that is. Nothing the browser claims about its own identity
 * is taken at face value, only what the signature proves.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const clientId = envOptional('AAD_CLIENT_ID');
  const tenantId = envText('AAD_TENANT_ID', 'common');

  if (!clientId) {
    return NextResponse.json({ error: 'Teams sign-in is not configured' }, { status: 503 });
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

  // The object id first, because it is the only identifier here that survives
  // somebody changing their name. Addresses second, all of them: a tenant whose
  // UPN is not its mail attribute is the common case, and the company's export
  // carries whichever one HR uses.
  const store = getStore();
  const employee = findEmployee(await store.listEmployees(), {
    externalId: identity.objectId ? { system: ENTRA, value: identity.objectId } : undefined,
    addresses: identity.addresses,
  });

  if (!employee) {
    console.warn(
      `[sofra] Teams sign-in matched nobody. oid=${identity.objectId || 'none'} addresses=${identity.addresses.join(', ') || 'none'}`,
    );
    return NextResponse.json({ error: 'No colleague with that address' }, { status: 403 });
  }

  // Learn the mapping, so the next sign-in is exact rather than a guess, and so
  // it keeps working after HR changes their address.
  if (identity.objectId && employee.externalIds?.[ENTRA] !== identity.objectId) {
    await store.linkExternalId(employee.id, ENTRA, identity.objectId);
  }

  await startSession(employee.id);
  return NextResponse.json({ employee: { id: employee.id, name: employee.displayName } });
}

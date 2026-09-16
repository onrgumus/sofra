import { NextResponse, type NextRequest } from 'next/server';
import { verifyTeamsToken } from '../../../../src/lib/teams-auth';
import { getStore } from '../../../../src/store/instance';
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

  const employee = (await getStore().listEmployees()).find(
    (e) => e.email.toLowerCase() === identity.email,
  );

  if (!employee) {
    // Signed in to Teams, but not in this company's directory.
    return NextResponse.json({ error: 'No colleague with that address' }, { status: 403 });
  }

  await startSession(employee.id);
  return NextResponse.json({ employee: { id: employee.id, name: employee.displayName } });
}

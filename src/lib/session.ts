import { cookies } from 'next/headers';
import type { Store } from '../store/types';
import { createSessionValue, readSessionValue } from './auth';
import { SESSION_COOKIE } from './session-cookie';

/**
 * Who the current visitor is acting as.
 *
 * Per-visitor, in a signed cookie: the company data is shared because it is one
 * company, but the session is not — otherwise two people opening the same link
 * would switch each other's account mid-click.
 *
 * Replacing this file and `src/lib/auth.ts` is the whole of adding real sign-in.
 */
export { SESSION_COOKIE };

const YEAR_IN_SECONDS = 60 * 60 * 24 * 365;

export async function currentEmployeeId(store: Store): Promise<string | null> {
  const jar = await cookies();
  const employeeId = readSessionValue(jar.get(SESSION_COOKIE)?.value);

  // A signature for someone who is no longer in the directory is not a session.
  return employeeId && store.getEmployee(employeeId) ? employeeId : null;
}

/**
 * Inside a Teams tab the app is a cross-site iframe, and a SameSite=Lax cookie
 * is simply not sent there — the session would appear to vanish on every
 * request. SameSite=None fixes that and requires Secure, which is why it is
 * opt-in rather than the default: it would break plain HTTP development for a
 * setting most deployments do not need.
 */
const EMBEDDED = process.env.SOFRA_ALLOW_EMBEDDING === 'true';

export async function startSession(employeeId: string): Promise<void> {
  const jar = await cookies();
  jar.set(SESSION_COOKIE, createSessionValue(employeeId), {
    httpOnly: true,
    sameSite: EMBEDDED ? 'none' : 'lax',
    path: '/',
    maxAge: YEAR_IN_SECONDS,
    secure: EMBEDDED || process.env.NODE_ENV === 'production',
  });
}

export async function endSession(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
}

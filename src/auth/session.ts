import { cookies, headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { cache } from 'react';
import { getDb } from '../db';
import { getPerson, touchLastSeen } from '../data/people';
import { deleteSession, findLiveSession, touchSession } from '../data/sessions';
import type { Person, Session, SignInMethod } from '../data/types';
import { SESSION_COOKIE } from '../lib/session-cookie';
import { embeddedInTeams } from '../lib/teams-mode';
import { roleOf, canManageOffice, type AdminRole } from './roles';
import { openSession, type RequestMeta } from './signin';
import { hashToken } from './tokens';

export { SESSION_COOKIE };

/**
 * How recently somebody must have proved who they are to use the console. A
 * session lasts a month; a laptop left open for a month should not be able to
 * re-plan a building's lunch or make somebody else an admin.
 */
export const ADMIN_FRESH_HOURS = 12;

/** The request's address and browser, for rate limits and the sessions list. */
export async function requestMeta(): Promise<RequestMeta> {
  const h = await headers();
  const forwarded = h.get('x-forwarded-for')?.split(',')[0]?.trim();
  return {
    ip: forwarded || h.get('x-real-ip') || 'unknown',
    userAgent: h.get('user-agent') ?? '',
  };
}

/**
 * Inside a Teams tab the app is a cross-site iframe: the cookie has to be
 * SameSite=None, Secure and Partitioned to be kept there at all. Everywhere
 * else it is an ordinary first-party cookie that no other site can send.
 */
function cookieOptions(expires: Date) {
  const embedded = embeddedInTeams();
  return {
    httpOnly: true,
    sameSite: embedded ? ('none' as const) : ('lax' as const),
    secure: embedded || process.env.NODE_ENV === 'production',
    path: '/',
    expires,
    ...(embedded ? { partitioned: true } : {}),
  };
}

export async function setSessionCookie(token: string, expires: Date): Promise<void> {
  (await cookies()).set(SESSION_COOKIE, token, cookieOptions(expires));
}

/** Signs somebody in: a new session, never a reused one, so a planted cookie is worthless. */
export async function signIn(person: Person, method: SignInMethod): Promise<void> {
  const session = await openSession(getDb(), person, method, await requestMeta());
  await setSessionCookie(session.token, session.expiresAt);
}

export interface Current {
  person: Person;
  session: Session;
}

/** Who is asking, once per request however many components ask. */
export const current = cache(async (): Promise<Current | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const db = getDb();
  const session = await findLiveSession(db, hashToken(token));
  if (!session) return null;
  const person = await getPerson(db, session.employeeId);
  if (!person || !person.active) return null;

  await touchSession(db, session.idHash);
  if (!person.lastSeenAt || Date.now() - Date.parse(person.lastSeenAt) > 3_600_000) {
    await touchLastSeen(db, person.id);
  }
  return { person, session };
});

export async function signOut(): Promise<void> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (token) await deleteSession(getDb(), hashToken(token));
  (await cookies()).set(SESSION_COOKIE, '', cookieOptions(new Date(0)));
}

/** The path being asked for, which the middleware passes along for sign-in redirects. */
async function currentPath(): Promise<string> {
  return (await headers()).get('x-sofra-path') ?? '/';
}

export async function requirePerson(): Promise<Current> {
  const me = await current();
  if (!me) redirect(`/login?next=${encodeURIComponent(await currentPath())}`);
  return me;
}

/** Signed in and has said where they work: everything but the welcome page needs this. */
export async function requireOnboarded(): Promise<Current> {
  const me = await requirePerson();
  if (!me.person.onboardedAt) redirect('/welcome');
  return me;
}

export const adminRole = cache(async (): Promise<AdminRole | null> => {
  const me = await current();
  return me ? roleOf(getDb(), me.person) : null;
});

export interface AdminContext extends Current {
  role: AdminRole;
}

/**
 * An admin who proved who they are recently. Anybody else gets a 404, not a
 * 403: the console's addresses are nobody else's business either. An admin
 * whose sign-in is old is asked to sign in again, and comes back here.
 */
export async function requireAdmin(
  scope: { officeId?: string; everyOffice?: boolean } = {},
): Promise<AdminContext> {
  const me = await requirePerson();
  const role = await adminRole();
  if (!role) notFound();
  if (scope.everyOffice && !role.everyOffice) notFound();
  if (scope.officeId && !canManageOffice(role, scope.officeId)) notFound();

  const age = Date.now() - Date.parse(me.session.authenticatedAt);
  if (age > ADMIN_FRESH_HOURS * 3_600_000) {
    redirect(`/login?reauth=1&next=${encodeURIComponent(await currentPath())}`);
  }
  return { ...me, role };
}

'use server';

import { redirect } from 'next/navigation';
import { current, requestMeta, setSessionCookie, signOut } from '../../src/auth/session';
import { redeemSignInLink, requestSignInLink } from '../../src/auth/signin';
import { getDb } from '../../src/db';
import { deleteSessionsOf } from '../../src/data/sessions';
import { hashToken } from '../../src/auth/tokens';
import { BASE_URL } from '../../src/lib/config';
import { safeRedirectPath } from '../../src/lib/redirect';
import { teamsOnly } from '../../src/lib/teams-mode';
import { configuredTransport, FROM_EMAIL } from '../../src/services/mail';
import { cookies } from 'next/headers';
import { SESSION_COOKIE } from '../../src/lib/session-cookie';

/** Sends a sign-in link. The page after says the same thing whoever asked. */
export async function requestLinkAction(formData: FormData): Promise<void> {
  if (teamsOnly()) redirect('/login');

  const email = String(formData.get('email') ?? '');
  const next = safeRedirectPath(formData.get('next'));
  const outcome = await requestSignInLink(
    getDb(),
    { transport: configuredTransport(), from: FROM_EMAIL, baseUrl: BASE_URL },
    { email, next, meta: await requestMeta() },
  );

  if (outcome === 'invalid') {
    redirect(`/login?error=invalid&next=${encodeURIComponent(next)}`);
  }
  if (outcome === 'rate-limited') {
    redirect(`/login?error=throttled&next=${encodeURIComponent(next)}`);
  }
  redirect(`/login/sent?email=${encodeURIComponent(email.trim().toLowerCase())}`);
}

/**
 * Uses a sign-in link. A button press rather than the click on the link
 * itself, because mail scanners follow links in incoming mail to check them,
 * and a link that signed in on GET would be spent before the person saw it.
 */
export async function confirmLinkAction(formData: FormData): Promise<void> {
  const token = String(formData.get('token') ?? '');
  const session = await redeemSignInLink(getDb(), token, await requestMeta());
  if (!session) redirect('/login?error=link');

  await setSessionCookie(session.token, session.expiresAt);
  redirect(session.person.onboardedAt ? session.next : '/welcome');
}

export async function signOutAction(): Promise<void> {
  await signOut();
  redirect('/login');
}

/** Signs out every other device: a lost phone, a shared machine. */
export async function signOutElsewhereAction(): Promise<void> {
  const me = await current();
  if (!me) redirect('/login');
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  await deleteSessionsOf(getDb(), me.person.id, token ? hashToken(token) : undefined);
  redirect('/you?signedOut=1');
}

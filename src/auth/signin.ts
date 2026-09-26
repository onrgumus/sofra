import type { Queryable } from '../db';
import {
  createPerson,
  findPerson,
  getPersonByEmail,
  linkEntra,
  normaliseEmail,
} from '../data/people';
import {
  consumeLoginToken,
  hitRateLimit,
  insertLoginToken,
  insertSession,
  peekLoginToken,
  retireLoginTokens,
} from '../data/sessions';
import { getSetting, isDomainAllowed } from '../data/settings';
import type { Person, SignInMethod } from '../data/types';
import { envOptional } from '../lib/env';
import { safeRedirectPath } from '../lib/redirect';
import type { EmailTransport } from '../notify/transport';
import { buildSignInMail } from '../notify/signin';
import { bootstrapAdminEmails } from './roles';
import { hashToken, randomToken } from './tokens';

export const LINK_MINUTES = 15;
export const SESSION_DAYS = 30;

/** Per address: enough for a typo and a retry, not for filling somebody's inbox. */
const PER_EMAIL = { limit: 5, windowSeconds: 15 * 60 };
/** Per network address: a whole office behind one NAT can still sign in. */
const PER_IP = { limit: 40, windowSeconds: 15 * 60 };

const ADDRESS = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface RequestMeta {
  ip: string;
  userAgent: string;
}

/**
 * Domains allowed without an admin having added them: SOFRA_ALLOWED_DOMAINS,
 * so a brand new deployment can let its first people in.
 */
export function bootstrapDomains(): string[] {
  return (envOptional('SOFRA_ALLOWED_DOMAINS') ?? '')
    .split(',')
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Whether this address may sign in by mail: an allowed domain, somebody
 * already here and active, or a bootstrap admin, who has to be able to get in
 * before any domain has been allowed.
 */
export async function mayUseEmailSignIn(db: Queryable, email: string): Promise<boolean> {
  const address = normaliseEmail(email);
  if (bootstrapAdminEmails().includes(address)) return true;
  const domain = address.slice(address.lastIndexOf('@') + 1);
  if (bootstrapDomains().includes(domain)) return true;
  if (await isDomainAllowed(db, address)) return true;
  const existing = await getPersonByEmail(db, address);
  return existing !== null && existing.active;
}

export type LinkRequestOutcome = 'sent' | 'rate-limited' | 'invalid';

/**
 * Sends a sign-in link, or quietly does not.
 *
 * The answer is the same whether or not the address may sign in, so the form
 * cannot be used to find out who works somewhere. Only a malformed address or
 * a rate limit get a different answer, and neither says anything about anyone.
 */
export async function requestSignInLink(
  db: Queryable,
  deps: { transport: EmailTransport; from: string; baseUrl: string },
  input: { email: string; next?: string; meta: RequestMeta },
): Promise<LinkRequestOutcome> {
  const email = normaliseEmail(input.email);
  if (!ADDRESS.test(email) || email.length > 254) return 'invalid';

  if (!(await hitRateLimit(db, `link-ip:${input.meta.ip}`, PER_IP.limit, PER_IP.windowSeconds))) {
    return 'rate-limited';
  }
  if (!(await hitRateLimit(db, `link:${email}`, PER_EMAIL.limit, PER_EMAIL.windowSeconds))) {
    return 'rate-limited';
  }

  if (!(await mayUseEmailSignIn(db, email))) {
    console.warn(`[sofra] sign-in link refused for ${email}: not an allowed domain`);
    return 'sent';
  }

  const token = randomToken();
  await retireLoginTokens(db, email);
  await insertLoginToken(db, {
    tokenHash: hashToken(token),
    email,
    nextPath: safeRedirectPath(input.next),
    expiresAt: new Date(Date.now() + LINK_MINUTES * 60_000),
    ip: input.meta.ip,
  });

  const mail = buildSignInMail({
    url: `${deps.baseUrl}/login/verify?token=${encodeURIComponent(token)}`,
    minutes: LINK_MINUTES,
    companyName: await getSetting(db, 'company_name', 'your company'),
  });
  await deps.transport.send({ from: deps.from, to: [email], ...mail });
  return 'sent';
}

/** Which address a link is for, without using it: for the page that asks "sign in as...?". */
export async function describeLink(db: Queryable, token: string) {
  return token ? peekLoginToken(db, hashToken(token)) : null;
}

export interface NewSession {
  token: string;
  person: Person;
  expiresAt: Date;
  next: string;
}

/**
 * Uses a link and opens a session. The link is spent even if what follows
 * refuses the person, so it cannot be tried twice.
 */
export async function redeemSignInLink(
  db: Queryable,
  token: string,
  meta: RequestMeta,
): Promise<NewSession | null> {
  if (!token) return null;
  if (!(await hitRateLimit(db, `redeem-ip:${meta.ip}`, 60, 15 * 60))) return null;

  const pending = await consumeLoginToken(db, hashToken(token));
  if (!pending) return null;

  const person =
    (await getPersonByEmail(db, pending.email)) ??
    (await createPerson(db, { email: pending.email, source: 'self' }));
  if (!person.active) return null;

  return { ...(await openSession(db, person, 'email', meta)), next: pending.nextPath };
}

/**
 * Somebody a trusted identity provider vouches for, by Teams token or OIDC:
 * found by object id or address, or created on first sign-in. Created only
 * where the provider is trusted for this company: the configured tenant, or an
 * allowed domain.
 */
export async function personForIdentity(
  db: Queryable,
  identity: {
    objectId: string | null;
    addresses: readonly string[];
    name: string | null;
    trustedTenant: boolean;
  },
): Promise<Person | null> {
  const found = await findPerson(db, {
    entraObjectId: identity.objectId,
    addresses: identity.addresses,
  });
  if (found) {
    if (identity.objectId && found.entraObjectId !== identity.objectId) {
      await linkEntra(db, found.id, identity.objectId);
    }
    return found.active ? found : null;
  }

  const email = identity.addresses[0];
  if (!email) return null;
  const allowed = identity.trustedTenant || (await mayUseEmailSignIn(db, email));
  if (!allowed) return null;

  return createPerson(db, {
    email,
    displayName: identity.name ?? '',
    source: 'self',
    entraObjectId: identity.objectId,
    aliases: identity.addresses.slice(1),
  });
}

export async function openSession(
  db: Queryable,
  person: Person,
  method: SignInMethod,
  meta: RequestMeta,
): Promise<{ token: string; person: Person; expiresAt: Date }> {
  const token = randomToken();
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000);
  await insertSession(db, {
    idHash: hashToken(token),
    employeeId: person.id,
    method,
    expiresAt,
    userAgent: meta.userAgent,
    ip: meta.ip,
  });
  return { token, person, expiresAt };
}

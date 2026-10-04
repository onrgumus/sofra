import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestDb, seedBasics, type TestDb } from './support/db';
import {
  describeLink,
  mayUseEmailSignIn,
  personForIdentity,
  redeemSignInLink,
  requestSignInLink,
} from '../src/auth/signin';
import { hashToken } from '../src/auth/tokens';
import { canManageOffice, roleOf, visibleOffices } from '../src/auth/roles';
import { addGrant } from '../src/data/admin';
import { createPerson, getPersonByEmail, setActive } from '../src/data/people';
import { findLiveSession } from '../src/data/sessions';
import type { EmailMessage, EmailTransport } from '../src/notify/transport';

let t: TestDb;

class Inbox implements EmailTransport {
  readonly name = 'inbox';
  sent: EmailMessage[] = [];
  async send(message: EmailMessage) {
    this.sent.push(message);
  }
  link(): string {
    const text = this.sent[this.sent.length - 1]?.text ?? '';
    return text.match(/token=([A-Za-z0-9_-]+)/)?.[1] ?? '';
  }
}

const inbox = new Inbox();
const deps = {
  transport: inbox,
  from: 'Sofra <sofra@acme.test>',
  baseUrl: 'https://sofra.acme.test',
};
const meta = { ip: '10.0.0.1', userAgent: 'vitest' };
let ipCounter = 0;
const freshMeta = () => ({ ip: `10.1.0.${++ipCounter}`, userAgent: 'vitest' });

beforeAll(async () => {
  t = await createTestDb();
  await seedBasics(t.db);
});
afterAll(async () => t.cleanup());
beforeEach(() => {
  inbox.sent = [];
  vi.unstubAllEnvs();
});

describe('asking for a sign-in link', () => {
  it('sends a single-use link to an allowed address, and stores only its hash', async () => {
    const outcome = await requestSignInLink(t.db, deps, {
      email: ' Ada@ACME.test ',
      next: '/admin',
      meta: freshMeta(),
    });
    expect(outcome).toBe('sent');
    expect(inbox.sent).toHaveLength(1);
    expect(inbox.sent[0]!.to).toEqual(['ada@acme.test']);
    expect(inbox.sent[0]!.text).toContain('https://sofra.acme.test/login/verify?token=');

    const token = inbox.link();
    const { rows } = await t.db.query<{ token_hash: string; next_path: string }>(
      'SELECT token_hash, next_path FROM login_tokens WHERE email = $1',
      ['ada@acme.test'],
    );
    expect(rows.map((r) => r.token_hash)).toEqual([hashToken(token)]);
    expect(rows.map((r) => r.token_hash)).not.toContain(token);
    expect(rows[0]!.next_path).toBe('/admin');
  });

  it('answers the same for an address that may not sign in, and sends nothing', async () => {
    expect(
      await requestSignInLink(t.db, deps, { email: 'mallory@evil.test', meta: freshMeta() }),
    ).toBe('sent');
    expect(inbox.sent).toEqual([]);
  });

  it('refuses something that is not an address', async () => {
    expect(await requestSignInLink(t.db, deps, { email: 'nope', meta: freshMeta() })).toBe(
      'invalid',
    );
  });

  it('never redirects anywhere but this site afterwards', async () => {
    await requestSignInLink(t.db, deps, {
      email: 'redirect@acme.test',
      next: '//evil.example/steal',
      meta: freshMeta(),
    });
    const pending = await describeLink(t.db, inbox.link());
    expect(pending?.nextPath).toBe('/');
  });

  it('stops after five links for one address in fifteen minutes', async () => {
    const outcomes = [];
    for (let i = 0; i < 6; i++) {
      outcomes.push(
        await requestSignInLink(t.db, deps, { email: 'spam@acme.test', meta: freshMeta() }),
      );
    }
    expect(outcomes).toEqual(['sent', 'sent', 'sent', 'sent', 'sent', 'rate-limited']);
  });

  it('sends nothing to somebody deactivated, though their domain is allowed', async () => {
    const left = await createPerson(t.db, { email: 'left@acme.test', source: 'self' });
    await setActive(t.db, left.id, false);
    expect(await mayUseEmailSignIn(t.db, 'left@acme.test')).toBe(false);
    expect(
      await requestSignInLink(t.db, deps, { email: 'left@acme.test', meta: freshMeta() }),
    ).toBe('sent');
    expect(inbox.sent).toEqual([]);
  });

  it('lets a bootstrap admin in before any domain is allowed', async () => {
    vi.stubEnv('SOFRA_ADMINS', 'boss@elsewhere.test');
    expect(await mayUseEmailSignIn(t.db, 'Boss@Elsewhere.test')).toBe(true);
    expect(await mayUseEmailSignIn(t.db, 'someone@elsewhere.test')).toBe(false);
    vi.stubEnv('SOFRA_ALLOWED_DOMAINS', 'elsewhere.test');
    expect(await mayUseEmailSignIn(t.db, 'someone@elsewhere.test')).toBe(true);
  });
});

describe('using a sign-in link', () => {
  it('works once, creates the person the first time, and opens a session', async () => {
    await requestSignInLink(t.db, deps, { email: 'new.person@acme.test', meta: freshMeta() });
    const token = inbox.link();

    expect((await describeLink(t.db, token))?.email).toBe('new.person@acme.test');
    // Looking at it does not use it: a mail scanner opening the page spends nothing.
    expect(await describeLink(t.db, token)).not.toBeNull();

    const session = await redeemSignInLink(t.db, token, meta);
    expect(session?.person.email).toBe('new.person@acme.test');
    expect(session?.person.onboardedAt).toBeNull();
    expect(await findLiveSession(t.db, hashToken(session!.token))).not.toBeNull();

    expect(await redeemSignInLink(t.db, token, meta)).toBeNull();
  });

  it('is worthless once a newer one was asked for', async () => {
    await requestSignInLink(t.db, deps, { email: 'twice@acme.test', meta: freshMeta() });
    const first = inbox.link();
    await requestSignInLink(t.db, deps, { email: 'twice@acme.test', meta: freshMeta() });
    expect(await redeemSignInLink(t.db, first, meta)).toBeNull();
    expect(await redeemSignInLink(t.db, inbox.link(), meta)).not.toBeNull();
  });

  it('expires after fifteen minutes', async () => {
    await requestSignInLink(t.db, deps, { email: 'late@acme.test', meta: freshMeta() });
    await t.db.query(
      "UPDATE login_tokens SET expires_at = now() - interval '1 second' WHERE email = 'late@acme.test'",
    );
    expect(await redeemSignInLink(t.db, inbox.link(), meta)).toBeNull();
  });

  it('does not let a deactivated person back in', async () => {
    const gone = await createPerson(t.db, { email: 'gone@acme.test', source: 'self' });
    await requestSignInLink(t.db, deps, { email: 'gone@acme.test', meta: freshMeta() });
    await setActive(t.db, gone.id, false);
    // Still answers "sent", and still sends nothing useful.
    expect(await redeemSignInLink(t.db, inbox.link(), meta)).toBeNull();
  });

  it('refuses a made-up token', async () => {
    expect(await redeemSignInLink(t.db, 'x'.repeat(43), meta)).toBeNull();
    expect(await redeemSignInLink(t.db, '', meta)).toBeNull();
  });
});

describe('somebody Teams or an identity provider vouches for', () => {
  it('is found by object id, and has it learned when found by address', async () => {
    const p = await createPerson(t.db, { email: 'known@acme.test', source: 'self' });
    const found = await personForIdentity(t.db, {
      objectId: 'oid-known',
      addresses: ['known@acme.test'],
      name: 'Known',
      trustedTenant: false,
    });
    expect(found?.id).toBe(p.id);
    const again = await personForIdentity(t.db, {
      objectId: 'oid-known',
      addresses: ['renamed@acme.test'],
      name: 'Known',
      trustedTenant: false,
    });
    expect(again?.id).toBe(p.id);
  });

  it('is created in the trusted tenant even at a domain nobody allowed', async () => {
    const created = await personForIdentity(t.db, {
      objectId: 'oid-tenant',
      addresses: ['ogumus@acme.onmicrosoft.com', 'onur.g@acme.test'],
      name: 'Onur G',
      trustedTenant: true,
    });
    expect(created).toMatchObject({
      email: 'ogumus@acme.onmicrosoft.com',
      displayName: 'Onur G',
      entraObjectId: 'oid-tenant',
    });
    expect(created?.aliases).toEqual(['onur.g@acme.test']);
  });

  it('is refused outside the tenant at a domain nobody allowed', async () => {
    expect(
      await personForIdentity(t.db, {
        objectId: 'oid-stranger',
        addresses: ['stranger@evil.test'],
        name: null,
        trustedTenant: false,
      }),
    ).toBeNull();
    expect(await getPersonByEmail(t.db, 'stranger@evil.test')).toBeNull();
  });
});

describe('admin roles', () => {
  it('reads every-office and per-office grants, and the bootstrap list', async () => {
    const plain = await createPerson(t.db, { email: 'plain@acme.test', source: 'self' });
    const local = await createPerson(t.db, { email: 'local@acme.test', source: 'self' });
    const chief = await createPerson(t.db, { email: 'chief@acme.test', source: 'self' });
    await addGrant(t.db, { employeeId: local.id, officeId: 'IST', grantedBy: 'test' });
    await addGrant(t.db, { employeeId: chief.id, officeId: null, grantedBy: 'test' });

    expect(await roleOf(t.db, plain)).toBeNull();
    const localRole = await roleOf(t.db, local);
    expect(localRole).toEqual({ everyOffice: false, officeIds: ['IST'], bootstrap: false });
    expect(canManageOffice(localRole, 'IST')).toBe(true);
    expect(canManageOffice(localRole, 'AMS')).toBe(false);
    expect(visibleOffices(localRole!, [{ id: 'IST' }, { id: 'AMS' }])).toEqual([{ id: 'IST' }]);
    expect((await roleOf(t.db, chief))?.everyOffice).toBe(true);

    vi.stubEnv('SOFRA_ADMINS', 'plain@acme.test');
    expect(await roleOf(t.db, plain)).toEqual({
      everyOffice: true,
      officeIds: [],
      bootstrap: true,
    });
  });

  it('gives a deactivated person no role at all', async () => {
    const chief = (await getPersonByEmail(t.db, 'chief@acme.test'))!;
    await setActive(t.db, chief.id, false);
    expect(await roleOf(t.db, { ...chief, active: false })).toBeNull();
  });
});

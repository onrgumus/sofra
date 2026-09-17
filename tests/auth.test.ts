import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEMO_PASSWORD,
  checkPassword,
  createSessionValue,
  createSignedPayload,
  readSessionValue,
  readSignedPayload,
} from '../src/lib/auth';
import { DemoStore } from '../src/store/demo';
import { DEMO_USERNAME, FEATURED_EMPLOYEE, pickRandomColleague } from '../src/store/featured';

describe('checkPassword', () => {
  it('accepts the demo password', async () => {
    expect(checkPassword(DEMO_PASSWORD)).toBe(true);
  });

  it('rejects anything else, including a prefix of the real one', async () => {
    for (const wrong of ['', '123', '12345', '1234 ', 'onur', 'Password1']) {
      expect(checkPassword(wrong)).toBe(false);
    }
  });
});

describe('the session secret', () => {
  const original = { env: process.env.NODE_ENV, secret: process.env.SOFRA_SESSION_SECRET };

  afterEach(() => {
    vi.stubEnv('NODE_ENV', original.env ?? 'test');
    if (original.secret === undefined) vi.stubEnv('SOFRA_SESSION_SECRET', '');
    else vi.stubEnv('SOFRA_SESSION_SECRET', original.secret);
    vi.unstubAllEnvs();
  });

  it('refuses to run in production on the published fallback', () => {
    // It is in this repository. Without a real one, anyone who has read the
    // source can forge a cookie for any employee and skip the password.
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('SOFRA_SESSION_SECRET', '');
    expect(() => createSessionValue('onur')).toThrow(/SOFRA_SESSION_SECRET is not set/);
  });

  it('refuses the fallback even when it is set explicitly', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('SOFRA_SESSION_SECRET', 'sofra-demo-secret-change-me-in-production');
    expect(() => createSessionValue('onur')).toThrow(/SOFRA_SESSION_SECRET is not set/);
  });

  it('is happy in production with a real one', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('SOFRA_SESSION_SECRET', 'a-long-random-string-from-the-deployment');
    expect(readSessionValue(createSessionValue('onur'))).toBe('onur');
  });

  it('leaves development alone, so a laptop needs no ceremony', () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('SOFRA_SESSION_SECRET', '');
    expect(readSessionValue(createSessionValue('onur'))).toBe('onur');
  });
});

describe('session cookies', () => {
  it('round-trips the employee it was issued for', async () => {
    const cookie = createSessionValue('onur');
    expect(readSessionValue(cookie)).toBe('onur');
  });

  it('cannot be forged by writing an employee id into devtools', async () => {
    // The whole point of signing: an unsigned or mis-signed value is not a
    // session, so you cannot become a colleague by editing a cookie.
    expect(readSessionValue('e0042')).toBeNull();
    expect(readSessionValue('e0042.')).toBeNull();
    expect(readSessionValue('e0042.notasignature')).toBeNull();
  });

  it('rejects a signature lifted from another account', async () => {
    const stolen = createSessionValue('onur').split('.')[1]!;
    expect(readSessionValue(`e0042.${stolen}`)).toBeNull();
  });

  it('treats a missing cookie as signed out', async () => {
    expect(readSessionValue(undefined)).toBeNull();
    expect(readSessionValue('')).toBeNull();
  });
});

describe('the demo account', () => {
  const store = new DemoStore(7, 160);

  it('is a real colleague in the seeded company', async () => {
    const onur = (await store.getEmployee(DEMO_USERNAME))!;
    expect(onur).toBeDefined();
    expect(onur.displayName).toBe('Onur GG');
    expect(onur.title).toBe('AI Digital Transformation Manager');
    expect(onur.officeId).toBe('IST-HQ');
  });

  it('is listed with everyone else, so the matcher can seat him', async () => {
    expect((await store.listEmployees('IST-HQ')).map((e) => e.id)).toContain(FEATURED_EMPLOYEE.id);
  });

  it('does not displace anyone — the company is still the requested size', async () => {
    expect(await store.listEmployees()).toHaveLength(160);
  });

  it('has a unique name like everyone else', async () => {
    const names = (await store.listEmployees()).map((e) => e.displayName);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe('pickRandomColleague', () => {
  const store = new DemoStore(7, 160);

  it('never hands out the shared demo account', async () => {
    // The whole reason it exists: several people on one link should not all end
    // up ticking the same boxes as Onur GG.
    for (const r of [0, 0.25, 0.5, 0.75, 0.999999]) {
      expect((await pickRandomColleague(store, () => r)).id).not.toBe(FEATURED_EMPLOYEE.id);
    }
  });

  it('stays in range at both ends', async () => {
    const colleagues = (await store.listEmployees()).filter((e) => e.id !== FEATURED_EMPLOYEE.id);
    expect((await pickRandomColleague(store, () => 0)).id).toBe(colleagues[0]!.id);
    expect((await pickRandomColleague(store, () => 0.999999)).id).toBe(colleagues.at(-1)!.id);
  });

  it('spreads people out rather than returning the same one', async () => {
    const picks = new Set(
      await Promise.all(
        Array.from(
          { length: 40 },
          async (_, i) => (await pickRandomColleague(store, () => i / 40)).id,
        ),
      ),
    );
    expect(picks.size).toBeGreaterThan(30);
  });

  it('falls back to the demo account when there is nobody else', async () => {
    const lonely = { listEmployees: async () => [FEATURED_EMPLOYEE] } as unknown as DemoStore;
    expect((await pickRandomColleague(lonely)).id).toBe(FEATURED_EMPLOYEE.id);
  });
});

describe('the signed handshake payload', () => {
  // The OIDC sign-in hands `state`, `nonce` and the PKCE verifier to the
  // browser and has to trust all three when they come back. Signed rather than
  // stored, because on a serverless platform the callback may reach a different
  // instance than the redirect did.
  const TEN_MINUTES = 10 * 60 * 1000;

  it('comes back exactly as it went out', () => {
    const value = JSON.stringify({ state: 'abc', next: '/you' });
    expect(readSignedPayload(createSignedPayload(value), TEN_MINUTES)).toBe(value);
  });

  it('refuses a payload somebody edited', () => {
    // Being able to choose your own state defeats the point of having one.
    // The body is base64url, so tamper with it there rather than with the
    // plain text, which is not what actually travels.
    const [issuedAt, encoded, signature] = createSignedPayload('{"state":"mine"}').split('.');
    const forged = Buffer.from('{"state":"yours"}', 'utf8').toString('base64url');

    expect(readSignedPayload(`${issuedAt}.${forged}.${signature}`, TEN_MINUTES)).toBeNull();
    expect(encoded).not.toBe(forged);
  });

  it("refuses a payload with somebody else's signature", () => {
    const [body] = createSignedPayload('{"state":"a"}').split('.').slice(0, 1);
    expect(readSignedPayload(`${body}.forged`, TEN_MINUTES)).toBeNull();
  });

  it('expires, because a valid signature on last week is still last week', () => {
    const issued = Date.now() - 11 * 60 * 1000;
    const signed = createSignedPayload('{"state":"a"}', issued);

    expect(readSignedPayload(signed, TEN_MINUTES)).toBeNull();
    expect(readSignedPayload(signed, 20 * 60 * 1000)).toBe('{"state":"a"}');
  });

  it('refuses one issued in the future, rather than trusting a rewound clock', () => {
    const signed = createSignedPayload('{"state":"a"}', Date.now() + 60_000);
    expect(readSignedPayload(signed, TEN_MINUTES)).toBeNull();
  });

  it('refuses nonsense without throwing', () => {
    for (const junk of [undefined, '', 'no-dots', 'a.b', '...']) {
      expect(readSignedPayload(junk, TEN_MINUTES)).toBeNull();
    }
  });
});

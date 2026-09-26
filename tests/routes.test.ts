import { createSign, generateKeyPairSync } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { createTestDb, seedBasics, type TestDb } from './support/db';
import { startFakeIdp, type FakeIdp } from './support/fake-idp';
import { getPersonByEmail } from '../src/data/people';
import { findLiveSession } from '../src/data/sessions';
import { hashToken } from '../src/auth/tokens';
import { resetJwksCache } from '../src/lib/jwt';

/**
 * The route handlers themselves, called the way Next calls them. What the
 * browser would do between them (follow a redirect, send a cookie back) is done
 * here by hand, against a real provider running on this machine.
 */
const jar = vi.hoisted(() => ({
  values: new Map<string, string>(),
  set: vi.fn((name: string, value: string) => {
    jar.values.set(name, value);
  }),
  get: vi.fn((name: string) =>
    jar.values.has(name) ? { name, value: jar.values.get(name)! } : undefined,
  ),
  delete: vi.fn(),
}));
vi.mock('next/headers', () => ({
  cookies: async () => jar,
  headers: async () => new Headers({ 'x-forwarded-for': '10.9.9.9', 'user-agent': 'routes-test' }),
}));

const BASE = 'http://sofra.test';
let t: TestDb;

beforeAll(async () => {
  vi.stubEnv('SOFRA_BASE_URL', BASE);
  vi.stubEnv('SOFRA_SESSION_SECRET', 'a-long-enough-secret-for-the-oidc-handshake-in-tests');
  t = await createTestDb();
  await seedBasics(t.db);
});
afterAll(async () => {
  vi.unstubAllEnvs();
  await t.cleanup();
});
beforeEach(() => {
  jar.values.clear();
  jar.set.mockClear();
});

async function sessionPerson(): Promise<string | null> {
  const token = jar.values.get('sofra_session');
  if (!token) return null;
  return (await findLiveSession(t.db, hashToken(token)))?.employeeId ?? null;
}

describe('company sign-in, end to end against a provider', () => {
  let idp: FakeIdp;
  let unverified: FakeIdp;

  beforeAll(async () => {
    idp = await startFakeIdp({ clientId: 'sofra-web', clientSecret: 'shh' });
    unverified = await startFakeIdp({ clientId: 'sofra-web', emailVerified: false });
  });
  afterAll(async () => {
    await idp.close();
    await unverified.close();
  });

  async function signInVia(provider: FakeIdp, email: string, tamper?: (url: URL) => void) {
    vi.stubEnv('SOFRA_OIDC_ISSUER', provider.issuer);
    vi.stubEnv('SOFRA_OIDC_CLIENT_ID', 'sofra-web');
    vi.stubEnv('SOFRA_OIDC_CLIENT_SECRET', 'shh');
    const { GET: start } = await import('../app/api/auth/oidc/start/route');
    const { GET: callback } = await import('../app/api/auth/oidc/callback/route');

    const begun = await start(new NextRequest(`${BASE}/api/auth/oidc/start?next=%2Fyou`));
    expect(begun.status).toBe(307);
    const handshake = begun.cookies.get('sofra_oidc')?.value;
    expect(handshake).toBeTruthy();

    // The browser goes to the provider, signs in, and is sent back.
    const authorize = new URL(begun.headers.get('location')!);
    expect(authorize.origin).toBe(provider.issuer);
    expect(authorize.searchParams.get('code_challenge_method')).toBe('S256');
    authorize.searchParams.set('email', email);
    const approved = await fetch(authorize, { redirect: 'manual' });
    expect(approved.status).toBe(302);
    const back = new URL(approved.headers.get('location')!);
    expect(back.origin + back.pathname).toBe(`${BASE}/api/auth/oidc/callback`);
    tamper?.(back);

    const request = new NextRequest(back, { headers: { cookie: `sofra_oidc=${handshake}` } });
    return { response: await callback(request), back, handshake: handshake!, callback };
  }

  it('signs a new colleague in and sends them to set up their profile', async () => {
    const { response } = await signInVia(idp, 'Ada@ACME.test');
    expect(response.status).toBe(307);
    expect(new URL(response.headers.get('location')!).pathname).toBe('/welcome');

    const ada = await getPersonByEmail(t.db, 'ada@acme.test');
    expect(ada).not.toBeNull();
    expect(await sessionPerson()).toBe(ada!.id);
  });

  it('refuses a callback whose state does not belong to this browser', async () => {
    const { response } = await signInVia(idp, 'eve@acme.test', (url) =>
      url.searchParams.set('state', 'forged'),
    );
    expect(response.headers.get('location')).toContain('/login?error=state');
    expect(jar.values.has('sofra_session')).toBe(false);
  });

  it('will not redeem the same code twice', async () => {
    const first = await signInVia(idp, 'bob@acme.test');
    expect(first.response.headers.get('location')).not.toContain('error');
    jar.values.clear();
    const replay = await first.callback(
      new NextRequest(first.back, { headers: { cookie: `sofra_oidc=${first.handshake}` } }),
    );
    expect(replay.headers.get('location')).toContain('/login?error=token');
    expect(jar.values.has('sofra_session')).toBe(false);
  });

  it('trusts no address the provider has not verified', async () => {
    const { response } = await signInVia(unverified, 'carol@acme.test');
    expect(response.headers.get('location')).toContain('/login?error=unknown');
    expect(await getPersonByEmail(t.db, 'carol@acme.test')).toBeNull();
  });

  it('lets nobody in from a domain the company has not allowed', async () => {
    const { response } = await signInVia(idp, 'mallory@evil.test');
    expect(response.headers.get('location')).toContain('/login?error=unknown');
    expect(await getPersonByEmail(t.db, 'mallory@evil.test')).toBeNull();
  });
});

describe('Teams sign-in', () => {
  const CLIENT = '11111111-2222-3333-4444-555555555555';
  const TENANT = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
  const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = {
    ...keys.publicKey.export({ format: 'jwk' }),
    kid: 'ms-1',
    alg: 'RS256',
    use: 'sig',
  };
  const realFetch = globalThis.fetch;

  function teamsToken(claims: Record<string, unknown> = {}): string {
    const enc = (v: object) => Buffer.from(JSON.stringify(v)).toString('base64url');
    const now = Math.floor(Date.now() / 1000);
    const head = enc({ alg: 'RS256', kid: 'ms-1', typ: 'JWT' });
    const body = enc({
      aud: CLIENT,
      iss: `https://login.microsoftonline.com/${TENANT}/v2.0`,
      tid: TENANT,
      oid: 'oid-teams-1',
      name: 'Deniz Teams',
      preferred_username: 'deniz@acme.onmicrosoft.test',
      exp: now + 600,
      nbf: now - 10,
      ...claims,
    });
    const signer = createSign('RSA-SHA256');
    signer.update(`${head}.${body}`);
    return `${head}.${body}.${signer.sign(keys.privateKey).toString('base64url')}`;
  }

  beforeAll(() => {
    // Microsoft's published keys, served locally.
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith('https://login.microsoftonline.com/common/discovery/v2.0/keys')) {
        return new Response(JSON.stringify({ keys: [jwk] }), { status: 200 });
      }
      return realFetch(input, init);
    }) as typeof fetch;
  });
  afterAll(() => {
    globalThis.fetch = realFetch;
  });
  afterEach(() => resetJwksCache());

  async function post(token: string, origin = BASE) {
    vi.stubEnv('AAD_CLIENT_ID', CLIENT);
    const { POST } = await import('../app/api/auth/teams/route');
    return POST(
      new NextRequest(`${BASE}/api/auth/teams`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin },
        body: JSON.stringify({ token }),
      }),
    );
  }

  it('creates somebody from the company tenant on first sign-in', async () => {
    vi.stubEnv('AAD_TENANT_ID', TENANT);
    const response = await post(teamsToken());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ onboarded: false });

    const deniz = await getPersonByEmail(t.db, 'deniz@acme.onmicrosoft.test');
    expect(deniz).toMatchObject({ displayName: 'Deniz Teams', entraObjectId: 'oid-teams-1' });
    expect(await sessionPerson()).toBe(deniz!.id);
  });

  it('refuses another site posting a token here', async () => {
    vi.stubEnv('AAD_TENANT_ID', TENANT);
    expect((await post(teamsToken(), 'https://evil.example')).status).toBe(403);
  });

  it('refuses a token from another tenant, or for another app', async () => {
    vi.stubEnv('AAD_TENANT_ID', TENANT);
    expect((await post(teamsToken({ tid: 'other-tenant' }))).status).toBe(401);
    expect((await post(teamsToken({ aud: 'someone-else' }))).status).toBe(401);
    expect(jar.values.has('sofra_session')).toBe(false);
  });

  it('with any tenant allowed, lets in only addresses at an allowed domain', async () => {
    vi.stubEnv('AAD_TENANT_ID', 'common');
    const outsider = await post(
      teamsToken({ oid: 'oid-outsider', preferred_username: 'guest@partner.test' }),
    );
    expect(outsider.status).toBe(403);
    const insider = await post(
      teamsToken({ oid: 'oid-insider', preferred_username: 'emre@acme.test' }),
    );
    expect(insider.status).toBe(200);
  });
});

describe('the scheduler’s endpoint', () => {
  async function tick(authorization?: string) {
    const { GET } = await import('../app/api/cron/tick/route');
    return GET(
      new NextRequest(`${BASE}/api/cron/tick`, {
        headers: authorization ? { authorization } : {},
      }),
    );
  }

  it('refuses to run without a secret configured, or with the wrong one', async () => {
    vi.stubEnv('CRON_SECRET', '');
    expect((await tick('Bearer anything')).status).toBe(503);
    vi.stubEnv('CRON_SECRET', 'right-secret');
    expect((await tick()).status).toBe(401);
    expect((await tick('Bearer wrong')).status).toBe(401);
  });

  it('runs with it, and says what it did', async () => {
    vi.stubEnv('CRON_SECRET', 'right-secret');
    const response = await tick('Bearer right-secret');
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ranAt: expect.any(String),
      actions: expect.any(Array),
    });
  });
});

describe('the bot’s endpoint', () => {
  const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = {
    ...keys.publicKey.export({ format: 'jwk' }),
    kid: 'bf-9',
    alg: 'RS256',
    use: 'sig',
  };
  const SERVICE = 'https://smba.trafficmanager.net/emea/';
  const realFetch = globalThis.fetch;
  const outbound: string[] = [];

  function botToken(): string {
    const enc = (v: object) => Buffer.from(JSON.stringify(v)).toString('base64url');
    const now = Math.floor(Date.now() / 1000);
    const head = enc({ alg: 'RS256', kid: 'bf-9', typ: 'JWT' });
    const body = enc({
      iss: 'https://api.botframework.com',
      aud: 'bot-app',
      serviceurl: SERVICE,
      exp: now + 600,
      nbf: now - 10,
    });
    const signer = createSign('RSA-SHA256');
    signer.update(`${head}.${body}`);
    return `${head}.${body}.${signer.sign(keys.privateKey).toString('base64url')}`;
  }

  beforeAll(() => {
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === 'https://login.botframework.com/v1/.well-known/keys') {
        return new Response(JSON.stringify({ keys: [jwk] }), { status: 200 });
      }
      if (url.includes('/oauth2/v2.0/token')) {
        return new Response(JSON.stringify({ access_token: 'bot-token', expires_in: 3600 }), {
          status: 200,
        });
      }
      if (url.startsWith(SERVICE)) {
        outbound.push(url);
        return new Response('{}', { status: 200 });
      }
      return realFetch(input, init);
    }) as typeof fetch;
  });
  afterAll(() => {
    globalThis.fetch = realFetch;
  });

  async function post(activity: Record<string, unknown>, authorization?: string) {
    vi.stubEnv('TEAMS_BOT_ID', 'bot-app');
    vi.stubEnv('TEAMS_BOT_PASSWORD', 'bot-secret');
    vi.stubEnv('TEAMS_BOT_TENANT_ID', 'tenant');
    const { POST } = await import('../app/api/teams/messages/route');
    return POST(
      new NextRequest(`${BASE}/api/teams/messages`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(authorization ? { authorization } : {}),
        },
        body: JSON.stringify(activity),
      }),
    );
  }

  const message = {
    type: 'message',
    serviceUrl: SERVICE,
    from: { id: '29:x', aadObjectId: 'oid-nobody' },
    conversation: { id: 'a:conv', conversationType: 'personal' },
  };

  it('answers the Bot Framework, and replies only to its service', async () => {
    const response = await post(message, `Bearer ${botToken()}`);
    expect(response.status).toBe(200);
    expect(outbound).toEqual([`${SERVICE}v3/conversations/a%3Aconv/activities`]);
  });

  it('refuses an unsigned request, and a service URL that is not Microsoft’s', async () => {
    expect((await post(message)).status).toBe(401);
    expect(
      (await post({ ...message, serviceUrl: 'https://evil.example/' }, `Bearer ${botToken()}`))
        .status,
    ).toBe(400);
  });
});

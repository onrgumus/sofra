import { beforeEach, describe, expect, it } from 'vitest';
import { createSign, createHash, generateKeyPairSync } from 'node:crypto';
import {
  authorizationUrl,
  beginHandshake,
  discover,
  exchangeCode,
  resetMetadataCache,
  statesMatch,
  verifyIdToken,
  type OidcConfig,
  type ProviderMetadata,
} from '../src/lib/oidc';
import { resetJwksCache } from '../src/lib/jwt';

const ISSUER = 'https://login.microsoftonline.com/tenant-1/v2.0';
const CLIENT_ID = 'sofra-client-id';

const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const attacker = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'key-1', alg: 'RS256', use: 'sig' };

const metadata: ProviderMetadata = {
  issuer: ISSUER,
  authorization_endpoint: `${ISSUER}/authorize`,
  token_endpoint: `${ISSUER}/token`,
  jwks_uri: `${ISSUER}/keys`,
};

const config: OidcConfig = {
  issuer: ISSUER,
  clientId: CLIENT_ID,
  clientSecret: 'shh',
  scopes: 'openid profile email',
  redirectUri: 'https://sofra.example.com/api/auth/oidc/callback',
};

const base64url = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');

function idToken(claims: Record<string, unknown> = {}, key = privateKey): string {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url({ alg: 'RS256', kid: 'key-1', typ: 'JWT' });
  const body = base64url({
    iss: ISSUER,
    aud: CLIENT_ID,
    sub: 'subject-1',
    email: 'onur.gumus@acme.com',
    email_verified: true,
    name: 'Onur Gumus',
    nonce: 'the-nonce',
    exp: now + 600,
    nbf: now - 10,
    ...claims,
  });

  const signer = createSign('RSA-SHA256');
  signer.update(`${header}.${body}`);
  return `${header}.${body}.${signer.sign(key).toString('base64url')}`;
}

/** Serves the key set, and a token endpoint, without a provider. */
function provider(options: { token?: string; tokenStatus?: number } = {}) {
  const calls: { url: string; body?: string }[] = [];

  const fetchImpl = (async (url: string, init?: { body?: string }) => {
    calls.push({ url: String(url), body: init?.body });

    if (String(url).endsWith('/keys')) {
      return { ok: true, json: async () => ({ keys: [jwk] }) } as unknown as Response;
    }
    if (String(url).includes('.well-known')) {
      return { ok: true, json: async () => metadata } as unknown as Response;
    }
    const status = options.tokenStatus ?? 200;
    return {
      ok: status === 200,
      status,
      text: async () => 'invalid_grant',
      json: async () => ({ id_token: options.token ?? idToken() }),
    } as unknown as Response;
  }) as unknown as typeof fetch;

  return { fetchImpl, calls };
}

describe('starting a sign-in', () => {
  beforeEach(() => {
    resetJwksCache();
    resetMetadataCache();
  });

  it('asks for a code, with PKCE and a nonce', () => {
    const handshake = beginHandshake('/');
    const url = new URL(authorizationUrl(config, metadata, handshake));

    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('client_id')).toBe(CLIENT_ID);
    expect(url.searchParams.get('redirect_uri')).toBe(config.redirectUri);
    expect(url.searchParams.get('state')).toBe(handshake.state);
    expect(url.searchParams.get('nonce')).toBe(handshake.nonce);
  });

  it('sends a hashed challenge, never the verifier itself', () => {
    // code_challenge_method=plain sends the secret the whole mechanism exists
    // to withhold from anyone watching the redirect.
    const handshake = beginHandshake('/');
    const url = new URL(authorizationUrl(config, metadata, handshake));

    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('code_challenge')).toBe(
      createHash('sha256').update(handshake.codeVerifier).digest('base64url'),
    );
    expect(url.toString()).not.toContain(handshake.codeVerifier);
  });

  it('makes every attempt unguessable and unlike the last', () => {
    const a = beginHandshake('/');
    const b = beginHandshake('/');

    expect(a.state).not.toBe(b.state);
    expect(a.nonce).not.toBe(b.nonce);
    expect(a.codeVerifier).not.toBe(b.codeVerifier);
    expect(a.state.length).toBeGreaterThanOrEqual(32);
    expect(a.codeVerifier.length).toBeGreaterThanOrEqual(43); // PKCE minimum
  });

  it('compares state without leaking it a character at a time', () => {
    expect(statesMatch('abc', 'abc')).toBe(true);
    expect(statesMatch('abc', 'abd')).toBe(false);
    expect(statesMatch('abc', 'ab')).toBe(false);
    expect(statesMatch('', '')).toBe(true);
  });
});

describe('discovery', () => {
  beforeEach(() => resetMetadataCache());

  it('reads the endpoints from the provider rather than hardcoding four sets', async () => {
    const { fetchImpl, calls } = provider();
    const found = await discover(ISSUER, fetchImpl);

    expect(found.token_endpoint).toBe(metadata.token_endpoint);
    expect(calls[0]?.url).toBe(`${ISSUER}/.well-known/openid-configuration`);
  });

  it('caches it, so a sign-in is not two round trips to the provider', async () => {
    const { fetchImpl, calls } = provider();
    await discover(ISSUER, fetchImpl);
    await discover(ISSUER, fetchImpl);

    expect(calls).toHaveLength(1);
  });

  it('refuses a document missing what it needs', async () => {
    const broken = (async () =>
      ({
        ok: true,
        json: async () => ({ issuer: ISSUER }),
      }) as unknown as Response) as typeof fetch;

    await expect(discover(ISSUER, broken)).rejects.toThrow(/missing authorization_endpoint/);
  });
});

describe('redeeming the code', () => {
  beforeEach(() => {
    resetJwksCache();
    resetMetadataCache();
  });

  const handshake = { state: 's', nonce: 'the-nonce', codeVerifier: 'verifier-1', next: '/' };

  it('returns who the provider says it is', async () => {
    const { fetchImpl } = provider();
    const identity = await exchangeCode({
      config,
      metadata,
      code: 'the-code',
      handshake,
      fetchImpl,
    });

    expect(identity.subject).toBe('subject-1');
    expect(identity.addresses).toEqual(['onur.gumus@acme.com']);
    expect(identity.name).toBe('Onur Gumus');
    expect(identity.emailVerified).toBe(true);
  });

  it('proves it is the one that asked, with the verifier and the secret', async () => {
    const { fetchImpl, calls } = provider();
    await exchangeCode({ config, metadata, code: 'the-code', handshake, fetchImpl });

    const tokenCall = calls.find((c) => c.url.endsWith('/token'))!;
    const body = new URLSearchParams(tokenCall.body!);
    expect(body.get('grant_type')).toBe('authorization_code');
    expect(body.get('code')).toBe('the-code');
    expect(body.get('code_verifier')).toBe('verifier-1');
    expect(body.get('client_secret')).toBe('shh');
    expect(body.get('redirect_uri')).toBe(config.redirectUri);
  });

  it('omits a secret it was not given, for a public client', async () => {
    const { fetchImpl, calls } = provider();
    const { clientSecret: _drop, ...publicClient } = config;

    await exchangeCode({ config: publicClient, metadata, code: 'c', handshake, fetchImpl });

    const tokenCall = calls.find((c) => c.url.endsWith('/token'))!;
    expect(new URLSearchParams(tokenCall.body!).has('client_secret')).toBe(false);
  });

  it('fails loudly when the provider rejects the code', async () => {
    const { fetchImpl } = provider({ tokenStatus: 400 });

    await expect(
      exchangeCode({ config, metadata, code: 'stale', handshake, fetchImpl }),
    ).rejects.toThrow(/Token exchange failed: 400/);
  });
});

describe('what makes an id_token acceptable', () => {
  beforeEach(() => resetJwksCache());

  function verify(token: string, nonce = 'the-nonce') {
    const { fetchImpl } = provider();
    return verifyIdToken({ idToken: token, config, metadata, nonce, fetchImpl });
  }

  it('rejects a token signed by somebody else', async () => {
    // The attack the whole flow rests on: well-formed claims, any values you
    // like, signed with a key the provider never published.
    await expect(verify(idToken({}, attacker.privateKey))).rejects.toThrow(
      /signature does not verify/,
    );
  });

  it('rejects alg:none rather than skipping the signature', async () => {
    const header = base64url({ alg: 'none', kid: 'key-1' });
    const body = base64url({ iss: ISSUER, aud: CLIENT_ID, sub: 'x', nonce: 'the-nonce' });

    await expect(verify(`${header}.${body}.`)).rejects.toThrow(/Unsupported token algorithm/);
  });

  it('rejects a token from another provider', async () => {
    await expect(verify(idToken({ iss: 'https://evil.example.com' }))).rejects.toThrow(
      /issued by another provider/,
    );
  });

  it('rejects a token meant for another application', async () => {
    await expect(verify(idToken({ aud: 'someone-elses-client' }))).rejects.toThrow(
      /different application/,
    );
  });

  it('accepts an audience array that includes us, which some providers send', async () => {
    const identity = await verify(idToken({ aud: ['other', CLIENT_ID] }));
    expect(identity.subject).toBe('subject-1');
  });

  it('rejects an expired token', async () => {
    const past = Math.floor(Date.now() / 1000) - 3600;
    await expect(verify(idToken({ exp: past }))).rejects.toThrow(/expired/);
  });

  it('rejects a token answering a different sign-in', async () => {
    // Replay: a valid token from an earlier attempt, fed to this one.
    await expect(verify(idToken({ nonce: 'an-older-attempt' }))).rejects.toThrow(
      /does not answer this sign-in/,
    );
  });

  it('rejects a token with no nonce at all', async () => {
    await expect(verify(idToken({ nonce: undefined }))).rejects.toThrow(
      /does not answer this sign-in/,
    );
  });

  it('rejects a token identifying nobody', async () => {
    await expect(verify(idToken({ sub: undefined, oid: undefined }))).rejects.toThrow(
      /identifies nobody/,
    );
  });
});

describe('who the token says you are', () => {
  beforeEach(() => resetJwksCache());

  function verify(claims: Record<string, unknown>) {
    const { fetchImpl } = provider();
    return verifyIdToken({
      idToken: idToken(claims),
      config,
      metadata,
      nonce: 'the-nonce',
      fetchImpl,
    });
  }

  it('prefers Entra object id as the subject, since that is what Teams carries', async () => {
    // Both doors into Sofra then record the same identifier for the same
    // person, so signing in one way and then the other finds one colleague.
    const identity = await verify({ oid: 'entra-object-id' });

    expect(identity.subject).toBe('entra-object-id');
    expect(identity.objectId).toBe('entra-object-id');
  });

  it('falls back to sub for providers with no oid', async () => {
    const identity = await verify({});
    expect(identity.subject).toBe('subject-1');
    expect(identity.objectId).toBeNull();
  });

  it('offers every address, because a UPN is often not the mail address', async () => {
    const identity = await verify({
      email: 'onur.gumus@acme.com',
      preferred_username: 'ogumus@acme.onmicrosoft.com',
    });

    expect(identity.addresses).toEqual(['onur.gumus@acme.com', 'ogumus@acme.onmicrosoft.com']);
  });

  it('ignores a preferred_username that is not an address', async () => {
    // Some providers put a bare username there, which would match nobody and
    // could collide with somebody else's local part.
    const identity = await verify({ email: undefined, preferred_username: 'ogumus' });
    expect(identity.addresses).toEqual([]);
  });

  it('reports an unverified address as unverified', async () => {
    // The callback refuses to match on one. Otherwise somebody registers
    // elsewhere with a colleague's address and is seated as them.
    const identity = await verify({ email_verified: false });
    expect(identity.emailVerified).toBe(false);
  });
});

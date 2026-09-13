import { beforeEach, describe, expect, it } from 'vitest';
import { createSign, generateKeyPairSync } from 'node:crypto';
import { resetJwksCache, verifyTeamsToken } from '../src/lib/teams-auth';

const CLIENT_ID = '11111111-2222-3333-4444-555555555555';
const TENANT_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const attacker = generateKeyPairSync('rsa', { modulusLength: 2048 });

const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'key-1', alg: 'RS256', use: 'sig' };

/** Serves Microsoft's key set, without Microsoft. */
const jwks = (async () =>
  ({
    ok: true,
    json: async () => ({ keys: [jwk] }),
  }) as unknown as Response) as unknown as typeof fetch;

const base64url = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');

function token(
  claims: Record<string, unknown> = {},
  header: Record<string, unknown> = {},
  key = privateKey,
): string {
  const now = Math.floor(Date.now() / 1000);
  const encodedHeader = base64url({ alg: 'RS256', kid: 'key-1', typ: 'JWT', ...header });
  const encodedClaims = base64url({
    aud: CLIENT_ID,
    iss: `https://login.microsoftonline.com/${TENANT_ID}/v2.0`,
    tid: TENANT_ID,
    oid: 'user-object-id',
    name: 'Onur GG',
    preferred_username: 'Onur@Example.com',
    exp: now + 600,
    nbf: now - 10,
    ...claims,
  });

  const signer = createSign('RSA-SHA256');
  signer.update(`${encodedHeader}.${encodedClaims}`);
  return `${encodedHeader}.${encodedClaims}.${signer.sign(key).toString('base64url')}`;
}

const options = { clientId: CLIENT_ID, tenantId: TENANT_ID, fetchImpl: jwks };

describe('verifyTeamsToken', () => {
  beforeEach(() => resetJwksCache());

  it('accepts a properly signed token and returns who it is for', async () => {
    const identity = await verifyTeamsToken(token(), options);
    expect(identity.email).toBe('onur@example.com'); // normalised, so lookups match
    expect(identity.name).toBe('Onur GG');
    expect(identity.tenantId).toBe(TENANT_ID);
  });

  it('rejects a token signed by somebody else', async () => {
    // The attack this whole file exists to prevent: a well-formed token with
    // any claims you like, signed with a key Microsoft never published.
    await expect(verifyTeamsToken(token({}, {}, attacker.privateKey), options)).rejects.toThrow(
      /signature does not verify/,
    );
  });

  it('refuses alg:none rather than skipping the signature', async () => {
    await expect(verifyTeamsToken(token({}, { alg: 'none' }), options)).rejects.toThrow(
      /Unsupported token algorithm/,
    );
  });

  it('refuses a token issued for another application', async () => {
    await expect(
      verifyTeamsToken(token({ aud: '99999999-0000-0000-0000-000000000000' }), options),
    ).rejects.toThrow(/different application/);
  });

  it('refuses a token from another tenant', async () => {
    await expect(verifyTeamsToken(token({ tid: 'someone-else' }), options)).rejects.toThrow(
      /another tenant/,
    );
  });

  it('accepts any tenant when configured for multi-tenant', async () => {
    const identity = await verifyTeamsToken(token({ tid: 'another-tenant' }), {
      ...options,
      tenantId: 'common',
    });
    expect(identity.tenantId).toBe('another-tenant');
  });

  it('refuses an expired token', async () => {
    const now = Math.floor(Date.now() / 1000);
    await expect(verifyTeamsToken(token({ exp: now - 3600 }), options)).rejects.toThrow(/expired/);
  });

  it('refuses a token that is not valid yet', async () => {
    const now = Math.floor(Date.now() / 1000);
    await expect(verifyTeamsToken(token({ nbf: now + 3600 }), options)).rejects.toThrow(
      /not valid yet/,
    );
  });

  it('refuses a token signed with a key that is not in the key set', async () => {
    await expect(verifyTeamsToken(token({}, { kid: 'unknown-key' }), options)).rejects.toThrow(
      /unknown key/,
    );
  });

  it('refuses an issuer that is not Microsoft', async () => {
    await expect(
      verifyTeamsToken(token({ iss: 'https://evil.example.com/v2.0' }), options),
    ).rejects.toThrow(/not issued by Microsoft/);
  });

  it('refuses a token carrying no address to match a colleague by', async () => {
    await expect(
      verifyTeamsToken(token({ preferred_username: undefined, upn: undefined }), options),
    ).rejects.toThrow(/no email address/);
  });

  it('refuses rubbish that is not a token at all', async () => {
    for (const junk of ['', 'not-a-token', 'a.b', 'a.b.c.d']) {
      await expect(verifyTeamsToken(junk, options)).rejects.toThrow(/Malformed token/);
    }
  });

  it('fetches the key set once and reuses it', async () => {
    let fetches = 0;
    const counting = (async () => {
      fetches++;
      return { ok: true, json: async () => ({ keys: [jwk] }) } as unknown as Response;
    }) as unknown as typeof fetch;

    await verifyTeamsToken(token(), { ...options, fetchImpl: counting });
    await verifyTeamsToken(token(), { ...options, fetchImpl: counting });
    expect(fetches).toBe(1);
  });
});

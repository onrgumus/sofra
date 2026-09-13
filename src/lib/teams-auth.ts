import { createPublicKey, createVerify, type JsonWebKey } from 'node:crypto';

/**
 * Verifies the token Teams hands a tab, so the server learns who the visitor is
 * without trusting the browser to say so.
 *
 * The tempting shortcut is `app.getContext()`, which gives you the user's email
 * in one line — client-side, where anyone can type whatever they like into a
 * fetch. This instead takes the signed token from `authentication.getAuthToken()`
 * and checks it against Microsoft's published keys: signature, issuer, audience
 * and expiry. Fail any one and there is no session.
 */
export interface TeamsAuthOptions {
  /** The Entra ID application (client) id this token must be addressed to. */
  clientId: string;
  /** Tenant id, or 'common' to accept any tenant. */
  tenantId: string;
  fetchImpl?: typeof fetch;
  /** Overridable so tests do not have to wait for the clock. */
  now?: () => number;
}

export interface TeamsIdentity {
  email: string;
  name: string | null;
  tenantId: string;
  objectId: string;
}

interface JwtHeader {
  alg: string;
  kid?: string;
}

interface JwtClaims {
  aud?: string;
  iss?: string;
  exp?: number;
  nbf?: number;
  tid?: string;
  oid?: string;
  name?: string;
  preferred_username?: string;
  upn?: string;
  email?: string;
}

const JWKS_URL = 'https://login.microsoftonline.com/common/discovery/v2.0/keys';
const CLOCK_SKEW_SECONDS = 120;

let jwksCache: { keys: JsonWebKey[]; fetchedAt: number } | null = null;
const JWKS_TTL_MS = 60 * 60 * 1000;

/** Exposed so tests start from a known state. */
export function resetJwksCache(): void {
  jwksCache = null;
}

export async function verifyTeamsToken(
  token: string,
  options: TeamsAuthOptions,
): Promise<TeamsIdentity> {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Malformed token');

  const [encodedHeader, encodedClaims, encodedSignature] = parts as [string, string, string];
  const header = decodeJson<JwtHeader>(encodedHeader);
  const claims = decodeJson<JwtClaims>(encodedClaims);

  // Only RS256. Accepting 'none', or whatever the token asks for, is the
  // classic way to make signature verification decorative.
  if (header.alg !== 'RS256') throw new Error(`Unsupported token algorithm: ${header.alg}`);

  const key = await findKey(header.kid, options);
  if (!key) throw new Error('Token signed with an unknown key');

  const verifier = createVerify('RSA-SHA256');
  verifier.update(`${encodedHeader}.${encodedClaims}`);
  const signature = Buffer.from(encodedSignature, 'base64url');

  if (!verifier.verify(createPublicKey({ key, format: 'jwk' }), signature)) {
    throw new Error('Token signature does not verify');
  }

  assertClaims(claims, options);

  const email = claims.preferred_username ?? claims.upn ?? claims.email;
  if (!email) throw new Error('Token carries no email address');

  return {
    email: email.toLowerCase(),
    name: claims.name ?? null,
    tenantId: claims.tid ?? '',
    objectId: claims.oid ?? '',
  };
}

function assertClaims(claims: JwtClaims, options: TeamsAuthOptions): void {
  const now = Math.floor((options.now?.() ?? Date.now()) / 1000);

  if (claims.exp === undefined || claims.exp + CLOCK_SKEW_SECONDS < now) {
    throw new Error('Token has expired');
  }
  if (claims.nbf !== undefined && claims.nbf - CLOCK_SKEW_SECONDS > now) {
    throw new Error('Token is not valid yet');
  }

  // A valid signature on a token meant for somebody else is not authorisation.
  const audiences = [options.clientId, `api://${options.clientId}`];
  if (
    !claims.aud ||
    !audiences.some((a) => a === claims.aud || claims.aud!.endsWith(options.clientId))
  ) {
    throw new Error('Token was issued for a different application');
  }

  if (!claims.iss?.startsWith('https://login.microsoftonline.com/')) {
    throw new Error('Token was not issued by Microsoft');
  }
  if (options.tenantId !== 'common' && claims.tid !== options.tenantId) {
    throw new Error('Token belongs to another tenant');
  }
}

async function findKey(
  kid: string | undefined,
  options: TeamsAuthOptions,
): Promise<JsonWebKey | null> {
  if (!kid) return null;

  const fresh = jwksCache && Date.now() - jwksCache.fetchedAt < JWKS_TTL_MS;
  if (!fresh) {
    const doFetch = options.fetchImpl ?? fetch;
    const response = await doFetch(JWKS_URL);
    if (!response.ok) throw new Error(`Could not fetch signing keys: ${response.status}`);

    const payload = (await response.json()) as { keys: (JsonWebKey & { kid?: string })[] };
    jwksCache = { keys: payload.keys, fetchedAt: Date.now() };
  }

  return (
    (jwksCache?.keys as (JsonWebKey & { kid?: string })[] | undefined)?.find(
      (k) => k.kid === kid,
    ) ?? null
  );
}

function decodeJson<T>(segment: string): T {
  try {
    return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8')) as T;
  } catch {
    throw new Error('Malformed token');
  }
}

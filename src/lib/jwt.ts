import { createPublicKey, createVerify, type JsonWebKey } from 'node:crypto';

/**
 * Checking that a JWT is what it says it is.
 *
 * Shared between the Teams tab and browser sign-in, which verify tokens from
 * the same kind of place for the same reason. Two copies of signature checking
 * is two places to get it subtly wrong, and only one of them would be noticed.
 *
 * No library. The parts that matter here are the parts a library would hide:
 * that the algorithm is pinned rather than read from the token, that the key
 * comes from the issuer's published set, and that a valid signature on a token
 * addressed to somebody else is not authorisation.
 */

/** Clocks drift. Two minutes is the usual allowance and Microsoft's own. */
export const CLOCK_SKEW_SECONDS = 120;

export interface JwtHeader {
  alg: string;
  kid?: string;
}

/** The claims every issuer sets. Callers narrow to their own on top of this. */
export interface StandardClaims {
  iss?: string;
  aud?: string | string[];
  exp?: number;
  nbf?: number;
  iat?: number;
  sub?: string;
  nonce?: string;
}

export interface VerifiedJwt<T> {
  header: JwtHeader;
  claims: T & StandardClaims;
}

export interface VerifyOptions {
  /** Where to fetch the issuer's signing keys. */
  jwksUri: string;
  fetchImpl?: typeof fetch;
}

/**
 * Verifies the signature and returns the claims, checking nothing about them.
 *
 * Deliberately split: a signature proves the token was issued by whoever owns
 * that key set, and says nothing about whether it was meant for you, whether it
 * has expired, or whether it is a replay. Those are separate decisions and the
 * caller makes them, because what counts as the right audience differs between
 * a Teams tab and a browser sign-in.
 */
export async function verifySignature<T>(
  token: string,
  options: VerifyOptions,
): Promise<VerifiedJwt<T>> {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Malformed token');

  const [encodedHeader, encodedClaims, encodedSignature] = parts as [string, string, string];
  const header = decodeJson<JwtHeader>(encodedHeader);
  const claims = decodeJson<T & StandardClaims>(encodedClaims);

  // Pinned, never read from the token. Accepting whatever the token asks for,
  // 'none' above all, is the classic way to make verification decorative.
  if (header.alg !== 'RS256') throw new Error(`Unsupported token algorithm: ${header.alg}`);

  const key = await findKey(header.kid, options);
  if (!key) throw new Error('Token signed with an unknown key');

  const verifier = createVerify('RSA-SHA256');
  verifier.update(`${encodedHeader}.${encodedClaims}`);

  if (
    !verifier.verify(
      createPublicKey({ key, format: 'jwk' }),
      Buffer.from(encodedSignature, 'base64url'),
    )
  ) {
    throw new Error('Token signature does not verify');
  }

  return { header, claims };
}

/** Expiry and not-before, with the usual allowance for clock drift. */
export function assertWithinLifetime(claims: StandardClaims, now = Date.now()): void {
  const seconds = Math.floor(now / 1000);

  if (claims.exp === undefined || claims.exp + CLOCK_SKEW_SECONDS < seconds) {
    throw new Error('Token has expired');
  }
  if (claims.nbf !== undefined && claims.nbf - CLOCK_SKEW_SECONDS > seconds) {
    throw new Error('Token is not valid yet');
  }
}

/** `aud` may be a string or an array; both have to be handled. */
export function audienceIncludes(claims: StandardClaims, expected: string): boolean {
  if (typeof claims.aud === 'string') return claims.aud === expected;
  return Array.isArray(claims.aud) && claims.aud.includes(expected);
}

/** Key sets, cached per URI so one provider's outage is not every request. */
const jwks = new Map<string, { keys: (JsonWebKey & { kid?: string })[]; fetchedAt: number }>();
const JWKS_TTL_MS = 60 * 60 * 1000;

/** Exposed so tests start from a known state. */
export function resetJwksCache(): void {
  jwks.clear();
}

async function findKey(
  kid: string | undefined,
  options: VerifyOptions,
): Promise<JsonWebKey | null> {
  if (!kid) return null;

  const cached = jwks.get(options.jwksUri);
  const fresh = cached && Date.now() - cached.fetchedAt < JWKS_TTL_MS;

  if (!fresh) {
    const doFetch = options.fetchImpl ?? fetch;
    const response = await doFetch(options.jwksUri);
    if (!response.ok) throw new Error(`Could not fetch signing keys: ${response.status}`);

    const payload = (await response.json()) as { keys: (JsonWebKey & { kid?: string })[] };
    jwks.set(options.jwksUri, { keys: payload.keys, fetchedAt: Date.now() });
  }

  // Providers rotate keys, so a kid we have never seen may be new rather than
  // forged. One refetch, then it really is unknown.
  const found = jwks.get(options.jwksUri)?.keys.find((k) => k.kid === kid);
  if (found || !fresh) return found ?? null;

  jwks.delete(options.jwksUri);
  return findKey(kid, options);
}

export function decodeJson<T>(segment: string): T {
  try {
    return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8')) as T;
  } catch {
    throw new Error('Malformed token');
  }
}

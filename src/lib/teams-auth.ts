import { assertWithinLifetime, verifySignature } from './jwt';
export { resetJwksCache } from './jwt';

/**
 * Verifies the token Teams hands a tab, so the server learns who the visitor is
 * without trusting the browser to say so.
 *
 * The tempting shortcut is `app.getContext()`, which gives you the user's email
 * in one line, client-side, where anyone can type whatever they like into a
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
  /** Every address the token offered, most authoritative first. */
  addresses: string[];
  /** The first of them, kept for logs and messages. */
  email: string;
  name: string | null;
  tenantId: string;
  objectId: string;
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

export async function verifyTeamsToken(
  token: string,
  options: TeamsAuthOptions,
): Promise<TeamsIdentity> {
  const { claims } = await verifySignature<JwtClaims>(token, {
    jwksUri: JWKS_URL,
    fetchImpl: options.fetchImpl,
  });

  assertClaims(claims, options);

  // Every address the token offers, not just the first. In a great many Entra
  // tenants the UPN is not the mail attribute, and a company's HR export
  // carries the mail one, so taking only `preferred_username` finds nobody.
  const addresses = [claims.preferred_username, claims.upn, claims.email]
    .filter((value): value is string => typeof value === 'string' && value !== '')
    .map((value) => value.toLowerCase());

  if (addresses.length === 0 && !claims.oid) {
    throw new Error('Token identifies nobody: no object id and no address');
  }

  return {
    addresses: [...new Set(addresses)],
    email: addresses[0] ?? '',
    name: claims.name ?? null,
    tenantId: claims.tid ?? '',
    objectId: claims.oid ?? '',
  };
}

function assertClaims(claims: JwtClaims, options: TeamsAuthOptions): void {
  assertWithinLifetime(claims, options.now?.() ?? Date.now());

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

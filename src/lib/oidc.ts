import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { assertWithinLifetime, audienceIncludes, verifySignature } from './jwt';
import { BASE_URL } from './config';
import { envOptional, envText } from './env';

/**
 * Signing in with the company's own account.
 *
 * The shared demo password is a gate, not authentication: anyone with the link
 * can be anyone, and somebody who leaves the company keeps getting in as long
 * as they remember it. OpenID Connect hands that question to whoever already
 * answers it every morning. Sofra never sees a password, an account being
 * disabled takes Sofra with it, and MFA and conditional access come from the
 * company's own settings without this code knowing they exist.
 *
 * Authorization code flow with PKCE, which is the shape every provider agrees
 * on. Discovery means Entra, Okta, Google Workspace and Auth0 differ by one
 * environment variable rather than by an adapter each.
 */

export interface OidcConfig {
  /** e.g. https://login.microsoftonline.com/<tenant>/v2.0 */
  issuer: string;
  clientId: string;
  /** Omitted for a public client; every server-side deployment should set it. */
  clientSecret?: string;
  scopes: string;
  redirectUri: string;
}

/** Null when this deployment has not been given a provider. */
export function oidcConfig(): OidcConfig | null {
  const issuer = envOptional('SOFRA_OIDC_ISSUER');
  const clientId = envOptional('SOFRA_OIDC_CLIENT_ID');
  if (!issuer || !clientId) return null;

  return {
    issuer: issuer.replace(/\/+$/, ''),
    clientId,
    clientSecret: envOptional('SOFRA_OIDC_CLIENT_SECRET'),
    // openid is the protocol; the other two are what turns a subject id into a
    // person we can find in the directory and address an invite to.
    scopes: envText('SOFRA_OIDC_SCOPES', 'openid profile email'),
    redirectUri: `${BASE_URL}/api/auth/oidc/callback`,
  };
}

export interface ProviderMetadata {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
}

const metadataCache = new Map<string, { value: ProviderMetadata; fetchedAt: number }>();
const METADATA_TTL_MS = 60 * 60 * 1000;

/** Exposed so tests start from a known state. */
export function resetMetadataCache(): void {
  metadataCache.clear();
}

/**
 * Asks the provider where its endpoints are, rather than hardcoding four sets.
 *
 * Every OIDC provider serves this document at the same well-known path, which
 * is the entire reason one implementation can cover all of them.
 */
export async function discover(
  issuer: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ProviderMetadata> {
  const cached = metadataCache.get(issuer);
  if (cached && Date.now() - cached.fetchedAt < METADATA_TTL_MS) return cached.value;

  const response = await fetchImpl(`${issuer}/.well-known/openid-configuration`);
  if (!response.ok) {
    throw new Error(`Could not read OIDC configuration from ${issuer}: ${response.status}`);
  }

  const value = (await response.json()) as ProviderMetadata;
  for (const field of ['issuer', 'authorization_endpoint', 'token_endpoint', 'jwks_uri'] as const) {
    if (!value[field]) throw new Error(`OIDC configuration is missing ${field}`);
  }

  metadataCache.set(issuer, { value, fetchedAt: Date.now() });
  return value;
}

/** The three one-time values a sign-in attempt has to remember about itself. */
export interface Handshake {
  /** Ties the callback to the browser that started it. Without it, an attacker
   * can feed somebody else's authorization code to a logged-in victim. */
  state: string;
  /** Ties the id_token to this attempt, so an old one cannot be replayed. */
  nonce: string;
  /** PKCE. Proves the code is being redeemed by whoever asked for it. */
  codeVerifier: string;
  /** Where to land afterwards, already checked to be a path on this site. */
  next: string;
}

export function beginHandshake(next: string): Handshake {
  return {
    state: randomBytes(32).toString('base64url'),
    nonce: randomBytes(32).toString('base64url'),
    codeVerifier: randomBytes(64).toString('base64url'),
    next,
  };
}

export function authorizationUrl(
  config: OidcConfig,
  metadata: ProviderMetadata,
  handshake: Handshake,
): string {
  const url = new URL(metadata.authorization_endpoint);

  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', config.clientId);
  url.searchParams.set('redirect_uri', config.redirectUri);
  url.searchParams.set('scope', config.scopes);
  url.searchParams.set('state', handshake.state);
  url.searchParams.set('nonce', handshake.nonce);
  url.searchParams.set('code_challenge', challengeOf(handshake.codeVerifier));
  url.searchParams.set('code_challenge_method', 'S256');

  return url.toString();
}

/** S256, never 'plain'. Plain sends the secret it exists to withhold. */
function challengeOf(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

/** Constant time, because `state` is a secret being compared to user input. */
export function statesMatch(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  return left.length === right.length && timingSafeEqual(left, right);
}

export interface OidcIdentity {
  /** The provider's immutable id for this person. Entra puts its object id in
   * `oid`; everyone else uses `sub`. */
  subject: string;
  /** Entra's object id specifically, when the token carries one. */
  objectId: string | null;
  /** Every address the token offered, most authoritative first. */
  addresses: string[];
  name: string | null;
  /** True only when the provider says so. An unverified address is a claim by
   * whoever registered the account, not by the company. */
  emailVerified: boolean;
}

interface IdTokenClaims {
  sub?: string;
  oid?: string;
  name?: string;
  email?: string;
  email_verified?: boolean;
  preferred_username?: string;
  upn?: string;
  nonce?: string;
}

/**
 * Trades the authorization code for tokens, and checks the one that matters.
 *
 * The access token is not interesting here: Sofra is not calling the provider's
 * APIs. The id_token is the whole point, and it is only worth what its
 * verification is worth.
 */
export async function exchangeCode(options: {
  config: OidcConfig;
  metadata: ProviderMetadata;
  code: string;
  handshake: Handshake;
  fetchImpl?: typeof fetch;
  now?: () => number;
}): Promise<OidcIdentity> {
  const { config, metadata, code, handshake } = options;
  const doFetch = options.fetchImpl ?? fetch;

  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: config.redirectUri,
    client_id: config.clientId,
    code_verifier: handshake.codeVerifier,
  });
  if (config.clientSecret) body.set('client_secret', config.clientSecret);

  const response = await doFetch(metadata.token_endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: body.toString(),
  });

  if (!response.ok) {
    // The provider's message can name the client id and the redirect URI, which
    // is useful in a server log and not for whoever is probing the endpoint.
    throw new Error(`Token exchange failed: ${response.status} ${await response.text()}`);
  }

  const payload = (await response.json()) as { id_token?: string };
  if (!payload.id_token) throw new Error('Token response carried no id_token');

  return verifyIdToken({
    idToken: payload.id_token,
    config,
    metadata,
    nonce: handshake.nonce,
    fetchImpl: options.fetchImpl,
    now: options.now,
  });
}

export async function verifyIdToken(options: {
  idToken: string;
  config: OidcConfig;
  metadata: ProviderMetadata;
  nonce: string;
  fetchImpl?: typeof fetch;
  now?: () => number;
}): Promise<OidcIdentity> {
  const { config, metadata, nonce } = options;

  const { claims } = await verifySignature<IdTokenClaims>(options.idToken, {
    jwksUri: metadata.jwks_uri,
    fetchImpl: options.fetchImpl,
  });

  // A signature only proves who issued it. Everything that makes this token
  // ours, current, and not a replay is checked here.
  if (claims.iss !== metadata.issuer) throw new Error('Token was issued by another provider');
  if (!audienceIncludes(claims, config.clientId)) {
    throw new Error('Token was issued for a different application');
  }
  assertWithinLifetime(claims, options.now?.() ?? Date.now());

  if (!claims.nonce || !statesMatch(claims.nonce, nonce)) {
    throw new Error('Token does not answer this sign-in');
  }

  const subject = claims.oid ?? claims.sub;
  if (!subject) throw new Error('Token identifies nobody');

  const addresses = [claims.email, claims.preferred_username, claims.upn]
    .filter((value): value is string => typeof value === 'string' && value.includes('@'))
    .map((value) => value.toLowerCase());

  return {
    subject,
    objectId: claims.oid ?? null,
    addresses: [...new Set(addresses)],
    name: claims.name ?? null,
    emailVerified: claims.email_verified === true,
  };
}

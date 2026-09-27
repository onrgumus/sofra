import { assertWithinLifetime, audienceIncludes, verifySignature } from '../lib/jwt';

/**
 * Checks that an activity really came from the Bot Framework for this bot.
 *
 * Anything can POST to the messaging endpoint. The Authorization header
 * carries a token the Bot Framework signed; its signature, issuer, audience
 * and lifetime are checked, and so is its serviceUrl claim, which must be the
 * one the activity asks us to reply to: otherwise a genuine token for one
 * conversation could steer replies somewhere else.
 */
export const BOT_FRAMEWORK_JWKS = 'https://login.botframework.com/v1/.well-known/keys';
export const BOT_FRAMEWORK_ISSUER = 'https://api.botframework.com';

interface BotClaims {
  iss?: string;
  aud?: string | string[];
  exp?: number;
  nbf?: number;
  serviceurl?: string;
  serviceUrl?: string;
}

export async function verifyBotRequest(
  authorization: string | null,
  options: {
    appId: string;
    serviceUrl: string;
    fetchImpl?: typeof fetch;
    now?: number;
    jwksUri?: string;
  },
): Promise<void> {
  const token = authorization?.match(/^Bearer (.+)$/)?.[1];
  if (!token) throw new Error('No bearer token');

  const { claims } = await verifySignature<BotClaims>(token, {
    jwksUri: options.jwksUri ?? BOT_FRAMEWORK_JWKS,
    fetchImpl: options.fetchImpl,
  });

  assertWithinLifetime(claims, options.now ?? Date.now());
  if (claims.iss !== BOT_FRAMEWORK_ISSUER)
    throw new Error('Token was not issued by the Bot Framework');
  if (!audienceIncludes(claims, options.appId)) throw new Error('Token is for another bot');

  const claimed = claims.serviceurl ?? claims.serviceUrl;
  if (!claimed || stripSlash(claimed) !== stripSlash(options.serviceUrl)) {
    throw new Error('Token is for another service URL');
  }
}

function stripSlash(url: string): string {
  return url.replace(/\/+$/, '').toLowerCase();
}

import type { BotConfig } from './config';
import { trustedServiceUrl } from './config';

/**
 * The two calls the bot makes outward: get a token, post an activity. No SDK,
 * for the same reason the Graph client has none: two calls do not justify
 * one, and a function is easy to hand a fake.
 */
export interface Connector {
  send(
    serviceUrl: string,
    conversationId: string,
    activity: Record<string, unknown>,
  ): Promise<void>;
}

export function createConnector(config: BotConfig, fetchImpl: typeof fetch = fetch): Connector {
  let cached: { token: string; expiresAt: number } | null = null;

  async function token(): Promise<string> {
    if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;
    const response = await fetchImpl(
      `https://login.microsoftonline.com/${encodeURIComponent(config.tenantId)}/oauth2/v2.0/token`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'client_credentials',
          client_id: config.appId,
          client_secret: config.appPassword,
          scope: 'https://api.botframework.com/.default',
        }),
      },
    );
    if (!response.ok) throw new Error(`Bot token request failed: ${response.status}`);
    const payload = (await response.json()) as { access_token: string; expires_in: number };
    cached = { token: payload.access_token, expiresAt: Date.now() + payload.expires_in * 1000 };
    return cached.token;
  }

  return {
    async send(serviceUrl, conversationId, activity) {
      if (!trustedServiceUrl(serviceUrl)) throw new Error(`Untrusted service URL: ${serviceUrl}`);
      const base = serviceUrl.replace(/\/+$/, '');
      const response = await fetchImpl(
        `${base}/v3/conversations/${encodeURIComponent(conversationId)}/activities`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${await token()}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(activity),
        },
      );
      if (!response.ok) {
        throw new Error(`Bot send failed: ${response.status} ${await response.text()}`);
      }
    },
  };
}

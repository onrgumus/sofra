/**
 * Minimal Microsoft Graph client: an app-only token and a request helper.
 *
 * No SDK, because the two calls Sofra makes do not justify one, and because a
 * function is far easier to hand a fake in a test.
 */
export interface GraphClientOptions {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  fetchImpl?: typeof fetch;
}

export type GraphRequest = (
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
) => Promise<Record<string, unknown>>;

export function createGraphClient(options: GraphClientOptions): GraphRequest {
  const doFetch = options.fetchImpl ?? fetch;
  let cached: { token: string; expiresAt: number } | null = null;

  async function token(): Promise<string> {
    // Reused until a minute before it expires, so a burst of invites is one
    // token request rather than one per table.
    if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;

    const response = await doFetch(
      `https://login.microsoftonline.com/${options.tenantId}/oauth2/v2.0/token`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: options.clientId,
          client_secret: options.clientSecret,
          scope: 'https://graph.microsoft.com/.default',
          grant_type: 'client_credentials',
        }),
      },
    );

    if (!response.ok) {
      throw new Error(`Graph token request failed: ${response.status} ${await response.text()}`);
    }

    const payload = (await response.json()) as { access_token: string; expires_in: number };
    cached = {
      token: payload.access_token,
      expiresAt: Date.now() + payload.expires_in * 1000,
    };
    return cached.token;
  }

  return async (method, path, body) => {
    const response = await doFetch(`https://graph.microsoft.com/v1.0${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${await token()}`,
        'Content-Type': 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(
        `Graph ${method} ${path} failed: ${response.status} ${await response.text()}`,
      );
    }
    // 201 with a body for chat creation, 200 with one for reads.
    return response.status === 204 ? {} : ((await response.json()) as Record<string, unknown>);
  };
}

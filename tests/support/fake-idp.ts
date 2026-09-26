import { createHash, createSign, generateKeyPairSync, randomBytes } from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

export interface FakeIdpOptions {
  clientId: string;
  clientSecret?: string;
  /** What the provider says about the address it vouches for. */
  emailVerified?: boolean;
  port?: number;
}

export interface FakeIdp {
  issuer: string;
  close(): Promise<void>;
}

interface Pending {
  clientId: string;
  redirectUri: string;
  challenge: string;
  nonce: string;
  email: string;
}

/**
 * A small OpenID Connect provider for tests and local trials: discovery, an
 * authorize page that asks for an address, a token endpoint that checks PKCE,
 * the client and the redirect, and a key set. Everything a real provider
 * checks, it checks, so a flow that works against it works for the reasons it
 * would against Entra or Okta.
 *
 * `/authorize?...&email=` skips the page, for tests that do not click.
 */
export async function startFakeIdp(options: FakeIdpOptions): Promise<FakeIdp> {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'idp-1', alg: 'RS256', use: 'sig' };
  const codes = new Map<string, Pending>();
  let issuer = '';

  const sign = (claims: Record<string, unknown>) => {
    const enc = (v: object) => Buffer.from(JSON.stringify(v)).toString('base64url');
    const head = enc({ alg: 'RS256', kid: 'idp-1', typ: 'JWT' });
    const body = enc(claims);
    const signer = createSign('RSA-SHA256');
    signer.update(`${head}.${body}`);
    return `${head}.${body}.${signer.sign(privateKey).toString('base64url')}`;
  };

  const issueCode = (params: URLSearchParams, email: string): string | null => {
    if (params.get('client_id') !== options.clientId) return null;
    if (params.get('response_type') !== 'code') return null;
    if (params.get('code_challenge_method') !== 'S256') return null;
    const code = randomBytes(16).toString('hex');
    codes.set(code, {
      clientId: params.get('client_id')!,
      redirectUri: params.get('redirect_uri') ?? '',
      challenge: params.get('code_challenge') ?? '',
      nonce: params.get('nonce') ?? '',
      email,
    });
    const back = new URL(params.get('redirect_uri') ?? '');
    back.searchParams.set('code', code);
    back.searchParams.set('state', params.get('state') ?? '');
    return back.toString();
  };

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', issuer);
    const body = await new Promise<string>((resolve) => {
      let data = '';
      req.on('data', (c) => (data += c));
      req.on('end', () => resolve(data));
    });
    const json = (status: number, value: unknown) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(value));
    };

    if (url.pathname === '/.well-known/openid-configuration') {
      return json(200, {
        issuer,
        authorization_endpoint: `${issuer}/authorize`,
        token_endpoint: `${issuer}/token`,
        jwks_uri: `${issuer}/jwks`,
      });
    }
    if (url.pathname === '/jwks') return json(200, { keys: [jwk] });

    if (url.pathname === '/authorize' && req.method === 'GET') {
      const email = url.searchParams.get('email');
      if (email) {
        const back = issueCode(url.searchParams, email);
        if (!back) return json(400, { error: 'invalid_request' });
        res.writeHead(302, { Location: back });
        return res.end();
      }
      const hidden = [...url.searchParams]
        .map(([k, v]) => `<input type="hidden" name="${esc(k)}" value="${esc(v)}">`)
        .join('');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(
        `<!doctype html><title>Test identity provider</title><body style="font-family:system-ui;padding:40px">` +
          `<h1>Test identity provider</h1><form method="post" action="/authorize">${hidden}` +
          `<label>Email <input name="email" type="email" required></label> <button type="submit">Sign in</button></form></body>`,
      );
    }
    if (url.pathname === '/authorize' && req.method === 'POST') {
      const params = new URLSearchParams(body);
      const back = issueCode(params, params.get('email') ?? '');
      if (!back) return json(400, { error: 'invalid_request' });
      res.writeHead(302, { Location: back });
      return res.end();
    }

    if (url.pathname === '/token' && req.method === 'POST') {
      const params = new URLSearchParams(body);
      const pending = codes.get(params.get('code') ?? '');
      codes.delete(params.get('code') ?? '');
      const challenge = createHash('sha256')
        .update(params.get('code_verifier') ?? '')
        .digest('base64url');
      if (
        !pending ||
        params.get('grant_type') !== 'authorization_code' ||
        params.get('client_id') !== pending.clientId ||
        params.get('redirect_uri') !== pending.redirectUri ||
        challenge !== pending.challenge ||
        (options.clientSecret && params.get('client_secret') !== options.clientSecret)
      ) {
        return json(400, { error: 'invalid_grant' });
      }
      const now = Math.floor(Date.now() / 1000);
      return json(200, {
        token_type: 'Bearer',
        access_token: randomBytes(16).toString('hex'),
        id_token: sign({
          iss: issuer,
          aud: options.clientId,
          sub: `sub-${pending.email}`,
          email: pending.email,
          email_verified: options.emailVerified ?? true,
          name: pending.email.split('@')[0],
          nonce: pending.nonce,
          iat: now,
          exp: now + 300,
        }),
      });
    }

    json(404, { error: 'not_found' });
  });

  await new Promise<void>((resolve) => server.listen(options.port ?? 0, '127.0.0.1', resolve));
  issuer = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  return {
    issuer,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

function esc(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { embeddedInTeams, openInTeamsUrl, teamsOnly } from '../src/lib/teams-mode';
import { oidcConfig } from '../src/lib/oidc';

/** What the session code hands Next's cookie jar, captured instead of sent. */
const jar = vi.hoisted(() => ({
  set: vi.fn(),
  get: vi.fn(),
  delete: vi.fn(),
}));
vi.mock('next/headers', () => ({ cookies: async () => jar, headers: async () => new Headers() }));

const { setSessionCookie, SESSION_COOKIE } = await import('../src/auth/session');

describe('Teams-only mode', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('is off unless asked for exactly', () => {
    expect(teamsOnly()).toBe(false);
    vi.stubEnv('SOFRA_TEAMS_ONLY', 'yes');
    expect(teamsOnly()).toBe(false);
    vi.stubEnv('SOFRA_TEAMS_ONLY', 'true');
    expect(teamsOnly()).toBe(true);
  });

  it('implies the cookie settings a Teams iframe needs', () => {
    expect(embeddedInTeams()).toBe(false);
    vi.stubEnv('SOFRA_TEAMS_ONLY', 'true');
    expect(embeddedInTeams()).toBe(true);
  });

  it('turns off company sign-in in a browser even where an issuer is configured', () => {
    vi.stubEnv('SOFRA_OIDC_ISSUER', 'https://login.microsoftonline.com/t/v2.0');
    vi.stubEnv('SOFRA_OIDC_CLIENT_ID', 'c');
    expect(oidcConfig()).not.toBeNull();

    vi.stubEnv('SOFRA_TEAMS_ONLY', 'true');
    expect(oidcConfig()).toBeNull();
  });

  it('links to the tab once it knows the app id', () => {
    expect(openInTeamsUrl()).toBeNull();
    vi.stubEnv('TEAMS_APP_ID', '11111111-2222-3333-4444-555555555555');
    expect(openInTeamsUrl()).toBe(
      'https://teams.microsoft.com/l/entity/11111111-2222-3333-4444-555555555555/sofra.lunches',
    );
  });

  it('refuses the emailed link even when the form is posted without being shown', () => {
    // Source-level, like the other action guards: calling a server action
    // needs a request context, and the rule is simple to state exactly.
    const source = readFileSync(new URL('../app/actions/auth.ts', import.meta.url), 'utf8');
    const start = source.indexOf('export async function requestLinkAction(');
    const body = source.slice(start, source.indexOf('\nexport async function ', start + 1));

    expect(body.indexOf('if (teamsOnly())')).toBeGreaterThan(-1);
    expect(body.indexOf('if (teamsOnly())')).toBeLessThan(body.indexOf('requestSignInLink('));
  });

  it('keeps the tab manifest and the deep link pointing at the same tab', () => {
    const manifest = JSON.parse(
      readFileSync(new URL('../teams/manifest.json', import.meta.url), 'utf8'),
    ) as { staticTabs: { entityId: string }[] };
    expect(manifest.staticTabs.map((t) => t.entityId)).toContain('sofra.lunches');
  });
});

describe('the session cookie inside Teams', () => {
  beforeEach(() => jar.set.mockClear());
  afterEach(() => vi.unstubAllEnvs());

  const expires = new Date('2026-12-01T00:00:00Z');

  it('is an ordinary first-party cookie outside Teams', async () => {
    await setSessionCookie('token', expires);

    const [, , options] = jar.set.mock.calls[0]!;
    expect(options).toMatchObject({ sameSite: 'lax', httpOnly: true, expires });
    expect(options).not.toHaveProperty('partitioned');
  });

  it('is cross-site, secure and partitioned when embedded', async () => {
    vi.stubEnv('SOFRA_TEAMS_ONLY', 'true');
    await setSessionCookie('token', expires);

    const [name, value, options] = jar.set.mock.calls[0]!;
    expect([name, value]).toEqual([SESSION_COOKIE, 'token']);
    expect(options).toMatchObject({
      sameSite: 'none',
      secure: true,
      partitioned: true,
      httpOnly: true,
    });
  });
});

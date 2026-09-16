import { afterEach, describe, expect, it, vi } from 'vitest';
import { demoModeEnabled, isAdmin } from '../src/lib/authz';
import { employee } from './helpers';

const onur = employee('onur', { email: 'Onur@Example.com' });
const someoneElse = employee('e0042', { email: 'other@example.com' });

describe('isAdmin', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('lets nobody in when the list is unset', () => {
    // An unconfigured deployment should refuse the console, not hand it to
    // whoever signs in first.
    vi.stubEnv('SOFRA_ADMINS', '');
    expect(isAdmin(onur)).toBe(false);
  });

  it('matches on employee id', () => {
    vi.stubEnv('SOFRA_ADMINS', 'onur');
    expect(isAdmin(onur)).toBe(true);
    expect(isAdmin(someoneElse)).toBe(false);
  });

  it('matches on email, case-insensitively, because a directory is not tidy', () => {
    vi.stubEnv('SOFRA_ADMINS', 'ONUR@EXAMPLE.COM');
    expect(isAdmin(onur)).toBe(true);
  });

  it('reads a list, and tolerates the spaces people leave', () => {
    vi.stubEnv('SOFRA_ADMINS', ' onur , other@example.com ,');
    expect(isAdmin(onur)).toBe(true);
    expect(isAdmin(someoneElse)).toBe(true);
  });

  it('refuses when there is no viewer at all', () => {
    vi.stubEnv('SOFRA_ADMINS', 'onur');
    expect(isAdmin(undefined)).toBe(false);
  });

  it('does not let an empty entry match an empty-ish id', () => {
    vi.stubEnv('SOFRA_ADMINS', ',,');
    expect(isAdmin(onur)).toBe(false);
  });
});

describe('demoModeEnabled', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('is off in production unless asked for', () => {
    // The account switcher is impersonation: sign in, become a colleague, read
    // their lunches, answer for them.
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('SOFRA_DEMO_MODE', '');
    expect(demoModeEnabled()).toBe(false);
  });

  it('can be turned on in production for a public demo', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('SOFRA_DEMO_MODE', 'true');
    expect(demoModeEnabled()).toBe(true);
  });

  it('is on in development, so a laptop needs no ceremony', () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('SOFRA_DEMO_MODE', '');
    expect(demoModeEnabled()).toBe(true);
  });

  it('can be turned off in development too', () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('SOFRA_DEMO_MODE', 'false');
    expect(demoModeEnabled()).toBe(false);
  });
});

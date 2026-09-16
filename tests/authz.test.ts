import { afterEach, describe, expect, it, vi } from 'vitest';
import { demoModeEnabled, isAdmin, isBootstrapAdmin } from '../src/lib/authz';
import { DemoStore } from '../src/store/demo';
import { employee } from './helpers';

const onur = employee('onur', { email: 'Onur@Example.com' });
const someoneElse = employee('e0042', { email: 'other@example.com' });

describe('isAdmin', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('lets nobody in when the list is unset', () => {
    // An unconfigured deployment should refuse the console, not hand it to
    // whoever signs in first.
    vi.stubEnv('SOFRA_ADMINS', '');
    expect(isBootstrapAdmin(onur)).toBe(false);
  });

  it('matches on employee id', () => {
    vi.stubEnv('SOFRA_ADMINS', 'onur');
    expect(isBootstrapAdmin(onur)).toBe(true);
    expect(isBootstrapAdmin(someoneElse)).toBe(false);
  });

  it('matches on email, case-insensitively, because a directory is not tidy', () => {
    vi.stubEnv('SOFRA_ADMINS', 'ONUR@EXAMPLE.COM');
    expect(isBootstrapAdmin(onur)).toBe(true);
  });

  it('reads a list, and tolerates the spaces people leave', () => {
    vi.stubEnv('SOFRA_ADMINS', ' onur , other@example.com ,');
    expect(isBootstrapAdmin(onur)).toBe(true);
    expect(isBootstrapAdmin(someoneElse)).toBe(true);
  });

  it('refuses when there is no viewer at all', () => {
    vi.stubEnv('SOFRA_ADMINS', 'onur');
    expect(isBootstrapAdmin(undefined)).toBe(false);
  });

  it('does not let an empty entry match an empty-ish id', () => {
    vi.stubEnv('SOFRA_ADMINS', ',,');
    expect(isBootstrapAdmin(onur)).toBe(false);
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

describe('admins granted in the app', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('lets a granted person in without a redeploy, which is the whole point', async () => {
    vi.stubEnv('SOFRA_ADMINS', '');
    const store = new DemoStore(7, 40);
    const colleague = (await store.listEmployees())[3]!;

    expect(await isAdmin(store, colleague)).toBe(false);

    await store.grantAdmin({
      employeeId: colleague.id,
      grantedBy: 'onur',
      grantedAt: new Date().toISOString(),
    });
    expect(await isAdmin(store, colleague)).toBe(true);

    await store.revokeAdmin(colleague.id);
    expect(await isAdmin(store, colleague)).toBe(false);
  });

  it('keeps the bootstrap list working when the database has nobody', async () => {
    // The way into a new deployment, and the way back in if the last granted
    // admin is removed by accident.
    vi.stubEnv('SOFRA_ADMINS', 'onur');
    const store = new DemoStore(7, 40);
    expect(await isAdmin(store, (await store.getEmployee('onur'))!)).toBe(true);
    expect(await store.listAdmins()).toEqual([]);
  });

  it('records who granted it and when', async () => {
    const store = new DemoStore(7, 40);
    const at = new Date().toISOString();
    await store.grantAdmin({ employeeId: 'e0005', grantedBy: 'onur', grantedAt: at });

    expect(await store.listAdmins()).toEqual([
      { employeeId: 'e0005', grantedBy: 'onur', grantedAt: at },
    ]);
  });
});

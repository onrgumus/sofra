import { describe, expect, it } from 'vitest';
import { DemoStore } from '../src/store/demo';
import {
  MAX_ATTEMPTS,
  checkSignInAllowed,
  clearSignInFailures,
  recordSignInFailure,
} from '../src/lib/throttle';

describe('sign-in throttling', () => {
  it('allows attempts until the limit', async () => {
    const store = new DemoStore(7, 40);
    for (let i = 0; i < MAX_ATTEMPTS - 1; i++) {
      expect((await checkSignInAllowed(store, 'onur')).allowed).toBe(true);
      await recordSignInFailure(store, 'onur');
    }
    expect((await checkSignInAllowed(store, 'onur')).allowed).toBe(true);
  });

  it('refuses once the limit is reached', async () => {
    const store = new DemoStore(7, 40);
    for (let i = 0; i < MAX_ATTEMPTS; i++) await recordSignInFailure(store, 'onur');
    expect((await checkSignInAllowed(store, 'onur')).allowed).toBe(false);
  });

  it('counts per username, so one account cannot lock out another', async () => {
    // Per address would let one attacker behind a shared egress lock out a
    // whole office.
    const store = new DemoStore(7, 40);
    for (let i = 0; i < MAX_ATTEMPTS; i++) await recordSignInFailure(store, 'onur');

    expect((await checkSignInAllowed(store, 'onur')).allowed).toBe(false);
    expect((await checkSignInAllowed(store, 'someone-else')).allowed).toBe(true);
  });

  it('treats the username the same however it is typed', async () => {
    const store = new DemoStore(7, 40);
    for (let i = 0; i < MAX_ATTEMPTS; i++) await recordSignInFailure(store, ' ONUR ');
    expect((await checkSignInAllowed(store, 'onur')).allowed).toBe(false);
  });

  it('forgets the count once a password works, so a typo costs nothing', async () => {
    const store = new DemoStore(7, 40);
    for (let i = 0; i < MAX_ATTEMPTS; i++) await recordSignInFailure(store, 'onur');
    expect((await checkSignInAllowed(store, 'onur')).allowed).toBe(false);

    await clearSignInFailures(store, 'onur');
    expect((await checkSignInAllowed(store, 'onur')).allowed).toBe(true);
  });

  it('forgets attempts once the window has passed', async () => {
    const store = new DemoStore(7, 40);
    const longAgo = new Date(Date.now() - 60 * 60_000);
    for (let i = 0; i < MAX_ATTEMPTS; i++) await recordSignInFailure(store, 'onur', longAgo);

    expect((await checkSignInAllowed(store, 'onur')).allowed).toBe(true);
  });
});

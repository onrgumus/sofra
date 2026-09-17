import { describe, expect, it } from 'vitest';
import { DirectoryCache } from '../src/directory';
import type { Directory } from '../src/directory';
import { employee } from './helpers';

/** A directory whose contents and failures the test controls. */
function directory(initial = [employee('e1')]) {
  const state = { people: initial, reads: 0, fail: false };
  const source: Directory = {
    name: 'test',
    listEmployees: async () => {
      state.reads++;
      if (state.fail) throw new Error('HR system is down');
      return state.people;
    },
  };
  return { source, state };
}

describe('DirectoryCache', () => {
  it('reads once within the window, however many lookups happen', async () => {
    // Reading per lookup would make one lunch page hundreds of HTTP calls to
    // somebody's HR system.
    const { source, state } = directory();
    const cache = new DirectoryCache({ directory: source, ttlMinutes: 15, now: () => 0 });

    for (let i = 0; i < 20; i++) await cache.people();
    expect(state.reads).toBe(1);
  });

  it('picks up a joiner once the window passes', async () => {
    // This is the bug it exists for: read once per process meant a new
    // colleague was invisible until something restarted, which on a
    // long-running server is never.
    let now = 0;
    const { source, state } = directory();
    const cache = new DirectoryCache({ directory: source, ttlMinutes: 15, now: () => now });

    expect((await cache.people()).size).toBe(1);

    state.people = [employee('e1'), employee('e2')];
    expect((await cache.people()).size).toBe(1); // still inside the window

    now = 16 * 60_000;
    expect((await cache.people()).size).toBe(2);
    expect(state.reads).toBe(2);
  });

  it('keeps the company it has when a refresh fails', async () => {
    // An HR export being briefly unreachable must not empty a building and
    // cancel lunch for everyone.
    let now = 0;
    const stale: unknown[] = [];
    const { source, state } = directory();
    const cache = new DirectoryCache({
      directory: source,
      ttlMinutes: 15,
      now: () => now,
      onStale: (error) => stale.push(error),
    });

    expect((await cache.people()).size).toBe(1);

    state.fail = true;
    now = 16 * 60_000;
    expect((await cache.people()).size).toBe(1);
    expect(stale).toHaveLength(1);
  });

  it('throws when the very first read fails, rather than serving nobody', async () => {
    // There is nothing to fall back to, and an empty company would look like a
    // day when nobody came in rather than like a broken deployment.
    const { source, state } = directory();
    state.fail = true;
    const cache = new DirectoryCache({ directory: source, ttlMinutes: 15, now: () => 0 });

    await expect(cache.people()).rejects.toThrow(/HR system is down/);
  });

  it('recovers on the next window after a failure', async () => {
    let now = 0;
    const { source, state } = directory();
    const cache = new DirectoryCache({ directory: source, ttlMinutes: 15, now: () => now });
    await cache.people();

    state.fail = true;
    now = 16 * 60_000;
    await cache.people();

    state.fail = false;
    state.people = [employee('e1'), employee('e2')];
    now = 32 * 60_000;
    expect((await cache.people()).size).toBe(2);
  });

  it('refreshes once when a burst arrives on a cold cache', async () => {
    // Otherwise every request in the burst fetches the whole company.
    const { source, state } = directory();
    const cache = new DirectoryCache({ directory: source, ttlMinutes: 15, now: () => 0 });

    await Promise.all(Array.from({ length: 10 }, () => cache.people()));
    expect(state.reads).toBe(1);
  });
});

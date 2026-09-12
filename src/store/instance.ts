import { DemoStore } from './demo';
import type { Store } from './types';

/**
 * One store per server process, cached on globalThis so it survives the module
 * reloads the dev server does on every edit. Swap this file for a Postgres-backed
 * implementation and nothing else in the app changes.
 */
const globalForStore = globalThis as unknown as { sofraStore?: Store };

export function getStore(): Store {
  globalForStore.sofraStore ??= new DemoStore();
  return globalForStore.sofraStore;
}

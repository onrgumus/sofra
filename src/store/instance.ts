import { DemoStore } from './demo';
import { SqliteStore } from './sqlite';
import type { Store } from './types';

/**
 * One store per server process, cached on globalThis so it survives the module
 * reloads the dev server does on every edit.
 *
 * With SOFRA_DATABASE set, state lives in a file and survives a restart, which
 * matters more than it sounds: "this invite was already sent" is state, and
 * losing it mails the whole building twice. Without it, everything is in
 * memory, which is fine for a demo and not for anything else.
 */
const globalForStore = globalThis as unknown as { sofraStore?: Store };

export function getStore(): Store {
  globalForStore.sofraStore ??= create();
  return globalForStore.sofraStore;
}

function create(): Store {
  const path = process.env.SOFRA_DATABASE;
  if (!path) return new DemoStore();

  // The synthetic company is still the reference data; only what changes is
  // persisted. A directory sync replaces this half without touching the store.
  const world = new DemoStore().world();
  const store = new SqliteStore({
    path,
    employees: world.employees,
    offices: world.offices,
    attendance: world.attendance,
  });

  // Seed once. A database that already has tables has already been seeded, and
  // re-adding the history every boot would make everyone look like a repeat.
  void seedOnce(store, world);
  return store;
}

async function seedOnce(store: SqliteStore, world: ReturnType<DemoStore['world']>): Promise<void> {
  if ((await store.listPastMatches()).length > 0) return;

  store.recordPastMatches(world.history);
  for (const optIn of world.optIns) await store.setOptIn(optIn);
}

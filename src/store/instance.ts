import { DemoStore } from './demo';
import { SqliteStore } from './sqlite';
import { PostgresStore } from './postgres';
import pg from 'pg';
import type { Store } from './types';
import { parseOffices } from '../lib/offices';

const { Pool } = pg;

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
  const world = new DemoStore().world();
  // Configured offices win over the demo's two invented ones. A deployment that
  // forgets this ends up matching people into a building that does not exist.
  const offices = parseOffices(process.env.SOFRA_OFFICES) ?? world.offices;

  // Postgres first: on a serverless platform the filesystem is ephemeral, so a
  // SQLite file would be empty on every cold start and we would be back to
  // mailing the building twice.
  const connectionString = process.env.DATABASE_URL;
  if (connectionString) {
    const store = new PostgresStore({
      pool: new Pool({
        connectionString,
        // Supabase's pooler terminates idle connections; a small pool with a
        // short idle timeout is what fits a serverless function anyway.
        max: Number(process.env.DATABASE_POOL_MAX ?? 3),
        idleTimeoutMillis: 10_000,
      }),
      employees: world.employees,
      offices,
      attendance: world.attendance,
    });
    void seedOnce(store, world);
    return store;
  }

  const path = process.env.SOFRA_DATABASE;
  if (!path) return new DemoStore();

  // The synthetic company is still the reference data; only what changes is
  // persisted. A directory sync replaces this half without touching the store.
  const store = new SqliteStore({
    path,
    employees: world.employees,
    offices,
    attendance: world.attendance,
  });

  // Seed once. A database that already has tables has already been seeded, and
  // re-adding the history every boot would make everyone look like a repeat.
  void seedOnce(store, world);
  return store;
}

async function seedOnce(
  store: SqliteStore | PostgresStore,
  world: ReturnType<DemoStore['world']>,
): Promise<void> {
  if ((await store.listPastMatches()).length > 0) return;

  await store.recordPastMatches(world.history);
  for (const optIn of world.optIns) await store.setOptIn(optIn);
}

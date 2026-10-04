import pg from 'pg';
import { MIGRATIONS, type Migration } from './migrations';

// DATE columns come back as the 'YYYY-MM-DD' they were stored as. The driver's
// default turns them into a Date at local midnight on the server, which is a
// different day in half the world's offices.
pg.types.setTypeParser(1082, (value: string) => value);
// BIGINT counts fit comfortably in a number here.
pg.types.setTypeParser(20, (value: string) => Number(value));

/** Anything a query can be run against: the pool, or a transaction's client. */
export interface Queryable {
  query<R extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: readonly unknown[],
  ): Promise<{ rows: R[]; rowCount: number | null }>;
}

export interface Db extends Queryable {
  /**
   * Runs `work` in one transaction on one connection. Everything it does
   * commits together or not at all.
   */
  transaction<T>(work: (tx: Queryable) => Promise<T>): Promise<T>;
  end(): Promise<void>;
}

export interface DbOptions {
  connectionString: string;
  /** A schema to work in, for tests that each want an empty database. */
  schema?: string;
  max?: number;
}

/**
 * A pool that has applied every migration before its first query.
 *
 * Migrations run once per process, under an advisory lock, so two instances
 * starting together do not both try to create the same table.
 */
export function createDb(options: DbOptions): Db {
  const pool = new pg.Pool({
    connectionString: options.connectionString,
    max: options.max ?? 10,
    idleTimeoutMillis: 10_000,
    ...(options.schema ? { options: `-c search_path=${options.schema}` } : {}),
  });

  let ready: Promise<void> | null = null;
  const migrated = () => (ready ??= migrate(pool, MIGRATIONS));

  return {
    async query(text, values) {
      await migrated();
      const result = await pool.query(text, values as unknown[] | undefined);
      return { rows: result.rows, rowCount: result.rowCount };
    },

    async transaction(work) {
      await migrated();
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const tx: Queryable = {
          async query(text, values) {
            const result = await client.query(text, values as unknown[] | undefined);
            return { rows: result.rows, rowCount: result.rowCount };
          },
        };
        const value = await work(tx);
        await client.query('COMMIT');
        return value;
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    },

    async end() {
      await pool.end();
    },
  };
}

/** Arbitrary but fixed: the lock every Sofra process takes to migrate. */
const MIGRATION_LOCK = 7_310_424_117;

export async function migrate(pool: pg.Pool, migrations: readonly Migration[]): Promise<void> {
  const client = await pool.connect();
  try {
    // One transaction, under a lock that ends with it. A session-level lock
    // would be left behind on a pooled connection: PgBouncer, and the hosted
    // databases built on it, hand each statement outside a transaction to
    // whichever server connection is free, so the unlock can miss the lock.
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1)', [MIGRATION_LOCK]);
    await client.query(
      `CREATE TABLE IF NOT EXISTS schema_migrations (
         id TEXT PRIMARY KEY,
         applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
       )`,
    );
    const applied = new Set(
      (await client.query<{ id: string }>('SELECT id FROM schema_migrations')).rows.map(
        (r) => r.id,
      ),
    );

    for (const migration of migrations) {
      if (applied.has(migration.id)) continue;
      try {
        await client.query(migration.sql);
        await client.query('INSERT INTO schema_migrations (id) VALUES ($1)', [migration.id]);
      } catch (error) {
        throw new Error(`Migration ${migration.id} failed: ${String(error)}`);
      }
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

const globalForDb = globalThis as unknown as { sofraDb?: Db };

/**
 * The application's database. There is exactly one kind: PostgreSQL, named by
 * DATABASE_URL. Without it nothing can be stored, so it refuses to start rather
 * than running on something that forgets.
 */
export function getDb(): Db {
  if (globalForDb.sofraDb) return globalForDb.sofraDb;

  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) {
    throw new Error('DATABASE_URL is not set. Sofra stores everything in PostgreSQL.');
  }
  globalForDb.sofraDb = createDb({
    connectionString,
    max: Number(process.env.DATABASE_POOL_MAX) || 10,
  });
  return globalForDb.sofraDb;
}

/** Replaces the process-wide database, for tests and scripts. */
export function setDb(db: Db | undefined): void {
  globalForDb.sofraDb = db;
}

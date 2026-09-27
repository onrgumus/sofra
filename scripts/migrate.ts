/**
 * Applies any migrations the database has not had yet, and exits. The app also
 * does this on its first query; this is for a deployment that would rather do
 * it as a release step.
 *
 *   npm run db:migrate
 */
import { existsSync } from 'node:fs';
import { createDb } from '../src/db';

async function main(): Promise<void> {
  if (existsSync('.env.local')) process.loadEnvFile('.env.local');
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set (environment or .env.local).');

  const db = createDb({ connectionString: url, max: 1 });
  try {
    await db.query('SELECT 1');
    const { rows } = await db.query<{ id: string }>('SELECT id FROM schema_migrations ORDER BY id');
    console.log(`Migrated. Applied: ${rows.map((r) => r.id).join(', ')}`);
  } finally {
    await db.end();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});

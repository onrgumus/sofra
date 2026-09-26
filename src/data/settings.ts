import type { Queryable } from '../db';
import { normaliseEmail } from './people';

export async function listAllowedDomains(db: Queryable): Promise<string[]> {
  const { rows } = await db.query<{ domain: string }>(
    'SELECT domain FROM allowed_domains ORDER BY domain',
  );
  return rows.map((r) => r.domain);
}

export async function addAllowedDomain(db: Queryable, domain: string): Promise<void> {
  await db.query('INSERT INTO allowed_domains (domain) VALUES ($1) ON CONFLICT DO NOTHING', [
    domain.trim().toLowerCase(),
  ]);
}

export async function removeAllowedDomain(db: Queryable, domain: string): Promise<void> {
  await db.query('DELETE FROM allowed_domains WHERE domain = $1', [domain.trim().toLowerCase()]);
}

/** The part after the last @, lowercased. Empty for something that is not an address. */
export function domainOf(email: string): string {
  const at = email.lastIndexOf('@');
  return at > 0 ? normaliseEmail(email.slice(at + 1)) : '';
}

/**
 * Whether an address may sign in with an emailed link.
 *
 * Exact domains only. A subdomain of an allowed domain is a different mail
 * system, often run by somebody else, and allowing it by suffix is how
 * `acme.com.attacker.net` gets in.
 */
export async function isDomainAllowed(db: Queryable, email: string): Promise<boolean> {
  const domain = domainOf(email);
  if (!domain) return false;
  const { rows } = await db.query('SELECT 1 FROM allowed_domains WHERE domain = $1', [domain]);
  return rows.length > 0;
}

export async function listDepartments(db: Queryable): Promise<string[]> {
  const { rows } = await db.query<{ name: string }>(
    'SELECT name FROM departments ORDER BY lower(name)',
  );
  return rows.map((r) => r.name);
}

/** Adds a department unless one with that name exists in any capitalisation. */
export async function addDepartment(db: Queryable, name: string): Promise<string> {
  const trimmed = name.trim().replace(/\s+/g, ' ');
  const existing = await db.query<{ name: string }>(
    'SELECT name FROM departments WHERE lower(name) = lower($1)',
    [trimmed],
  );
  if (existing.rows[0]) return existing.rows[0].name;
  await db.query('INSERT INTO departments (name) VALUES ($1) ON CONFLICT DO NOTHING', [trimmed]);
  return trimmed;
}

export async function renameDepartment(db: Queryable, from: string, to: string): Promise<void> {
  await db.query('UPDATE departments SET name = $2 WHERE name = $1', [from, to.trim()]);
}

/** Refuses while anybody is still in it: their records would point at nothing. */
export async function removeDepartment(db: Queryable, name: string): Promise<boolean> {
  const used = await db.query('SELECT 1 FROM employees WHERE department = $1 LIMIT 1', [name]);
  if (used.rows.length > 0) return false;
  await db.query('DELETE FROM departments WHERE name = $1', [name]);
  return true;
}

export async function getSetting<T>(db: Queryable, key: string, fallback: T): Promise<T> {
  const { rows } = await db.query<{ value: T }>('SELECT value FROM settings WHERE key = $1', [key]);
  return rows[0] ? rows[0].value : fallback;
}

export async function setSetting(db: Queryable, key: string, value: unknown): Promise<void> {
  await db.query(
    `INSERT INTO settings (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [key, JSON.stringify(value)],
  );
}

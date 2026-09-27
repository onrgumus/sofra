import { randomUUID } from 'node:crypto';
import type { Employee, Seniority } from '../core/types';
import type { Queryable } from '../db';
import type { EmployeeSource, Person } from './types';

interface PersonRow extends Record<string, unknown> {
  id: string;
  email: string;
  display_name: string;
  title: string;
  department: string | null;
  team: string;
  seniority: string | null;
  office_id: string | null;
  languages: string[];
  interests: string[];
  started_on: string | null;
  aliases: string[];
  entra_object_id: string | null;
  slack_user_id: string | null;
  source: string;
  active: boolean;
  onboarded_at: Date | null;
  reminders: boolean;
  created_at: Date;
  last_seen_at: Date | null;
}

export function toPerson(row: PersonRow): Person {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    title: row.title,
    department: row.department,
    team: row.team,
    seniority: row.seniority as Seniority | null,
    officeId: row.office_id,
    languages: row.languages,
    interests: row.interests,
    startedOn: row.started_on,
    aliases: row.aliases,
    entraObjectId: row.entra_object_id,
    slackUserId: row.slack_user_id,
    source: row.source as EmployeeSource,
    active: row.active,
    onboardedAt: row.onboarded_at?.toISOString() ?? null,
    reminders: row.reminders,
    createdAt: row.created_at.toISOString(),
    lastSeenAt: row.last_seen_at?.toISOString() ?? null,
  };
}

/** Lowercased and trimmed: addresses are compared as the mail system would. */
export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Whether somebody has told us everything a table needs. */
export function isMatchable(person: Person): boolean {
  return (
    person.active &&
    person.onboardedAt !== null &&
    person.department !== null &&
    person.seniority !== null &&
    person.officeId !== null &&
    person.languages.length > 0
  );
}

/**
 * The matcher's view of a person, in the office they are eating at that day,
 * which is not always the one they usually work in.
 */
export function toEmployee(person: Person, officeId?: string, now = new Date()): Employee {
  const department = person.department ?? '';
  return {
    id: person.id,
    displayName: person.displayName || person.email,
    email: person.email,
    title: person.title || department,
    seniority: person.seniority ?? 'mid',
    department,
    // Teams are only unique inside a department: two departments can both have
    // a "Platform" team, and they are not the same people.
    team: person.team ? `${department}/${person.team}` : department,
    officeId: officeId ?? person.officeId ?? '',
    languages: person.languages.length > 0 ? person.languages : ['en'],
    tenureMonths: person.startedOn ? monthsSince(person.startedOn, now) : 0,
    interests: person.interests,
    ...(person.aliases.length > 0 ? { aliases: person.aliases } : {}),
    externalIds: {
      ...(person.entraObjectId ? { entra: person.entraObjectId } : {}),
      ...(person.slackUserId ? { slack: person.slackUserId } : {}),
    },
  };
}

function monthsSince(isoDate: string, now: Date): number {
  const start = new Date(`${isoDate}T00:00:00Z`);
  const months =
    (now.getUTCFullYear() - start.getUTCFullYear()) * 12 +
    (now.getUTCMonth() - start.getUTCMonth()) -
    (now.getUTCDate() < start.getUTCDate() ? 1 : 0);
  return Math.max(0, months);
}

export async function getPerson(db: Queryable, id: string): Promise<Person | null> {
  const { rows } = await db.query<PersonRow>('SELECT * FROM employees WHERE id = $1', [id]);
  return rows[0] ? toPerson(rows[0]) : null;
}

export async function getPeople(db: Queryable, ids: readonly string[]): Promise<Person[]> {
  if (ids.length === 0) return [];
  const { rows } = await db.query<PersonRow>('SELECT * FROM employees WHERE id = ANY($1)', [
    [...ids],
  ]);
  return rows.map(toPerson);
}

export async function getPersonByEmail(db: Queryable, email: string): Promise<Person | null> {
  const { rows } = await db.query<PersonRow>('SELECT * FROM employees WHERE email = $1', [
    normaliseEmail(email),
  ]);
  return rows[0] ? toPerson(rows[0]) : null;
}

export interface IdentityLookup {
  entraObjectId?: string | null;
  addresses?: readonly string[];
}

/**
 * Who this is, most reliable evidence first: an Entra object id survives a
 * name change and an address does not, and a primary address beats somebody
 * else's alias.
 */
export async function findPerson(db: Queryable, lookup: IdentityLookup): Promise<Person | null> {
  if (lookup.entraObjectId) {
    const { rows } = await db.query<PersonRow>(
      'SELECT * FROM employees WHERE entra_object_id = $1',
      [lookup.entraObjectId],
    );
    if (rows[0]) return toPerson(rows[0]);
  }

  const addresses = [...new Set((lookup.addresses ?? []).map(normaliseEmail))].filter(Boolean);
  if (addresses.length === 0) return null;

  const primary = await db.query<PersonRow>('SELECT * FROM employees WHERE email = ANY($1)', [
    addresses,
  ]);
  const byPrimary = addresses
    .map((a) => primary.rows.find((r) => r.email === a))
    .find((r) => r !== undefined);
  if (byPrimary) return toPerson(byPrimary);

  const alias = await db.query<PersonRow>(
    'SELECT * FROM employees WHERE aliases && $1::text[] ORDER BY created_at LIMIT 1',
    [addresses],
  );
  return alias.rows[0] ? toPerson(alias.rows[0]) : null;
}

export interface NewPerson {
  email: string;
  displayName?: string;
  source: EmployeeSource;
  entraObjectId?: string | null;
  title?: string;
  department?: string | null;
  team?: string;
  seniority?: Seniority | null;
  officeId?: string | null;
  languages?: string[];
  interests?: string[];
  startedOn?: string | null;
  aliases?: string[];
  onboarded?: boolean;
}

export async function createPerson(db: Queryable, person: NewPerson): Promise<Person> {
  const { rows } = await db.query<PersonRow>(
    `INSERT INTO employees
       (id, email, display_name, title, department, team, seniority, office_id, languages,
        interests, started_on, aliases, entra_object_id, source, onboarded_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
             CASE WHEN $15 THEN now() ELSE NULL END)
     RETURNING *`,
    [
      randomUUID(),
      normaliseEmail(person.email),
      person.displayName?.trim() ?? '',
      person.title?.trim() ?? '',
      person.department ?? null,
      person.team?.trim() ?? '',
      person.seniority ?? null,
      person.officeId ?? null,
      person.languages && person.languages.length > 0 ? person.languages : ['en'],
      person.interests ?? [],
      person.startedOn ?? null,
      (person.aliases ?? []).map(normaliseEmail),
      person.entraObjectId ?? null,
      person.source,
      person.onboarded ?? false,
    ],
  );
  return toPerson(rows[0]!);
}

export interface ProfileUpdate {
  displayName: string;
  title: string;
  department: string;
  team: string;
  seniority: Seniority;
  officeId: string;
  languages: string[];
  interests: string[];
  startedOn: string | null;
}

/**
 * What somebody says about themselves on the welcome page and their own page.
 * Saving it the first time is what makes them matchable.
 */
export async function saveProfile(
  db: Queryable,
  id: string,
  profile: ProfileUpdate,
): Promise<Person> {
  const { rows } = await db.query<PersonRow>(
    `UPDATE employees SET display_name = $2, title = $3, department = $4, team = $5,
       seniority = $6, office_id = $7, languages = $8, interests = $9, started_on = $10,
       onboarded_at = coalesce(onboarded_at, now()), updated_at = now()
     WHERE id = $1 RETURNING *`,
    [
      id,
      profile.displayName,
      profile.title,
      profile.department,
      profile.team,
      profile.seniority,
      profile.officeId,
      profile.languages,
      profile.interests,
      profile.startedOn,
    ],
  );
  if (!rows[0]) throw new Error(`No employee ${id}`);
  return toPerson(rows[0]);
}

export async function setReminders(db: Queryable, id: string, enabled: boolean): Promise<void> {
  await db.query('UPDATE employees SET reminders = $2, updated_at = now() WHERE id = $1', [
    id,
    enabled,
  ]);
}

export async function setActive(db: Queryable, id: string, active: boolean): Promise<void> {
  await db.query('UPDATE employees SET active = $2, updated_at = now() WHERE id = $1', [
    id,
    active,
  ]);
}

export async function setOffice(db: Queryable, id: string, officeId: string | null): Promise<void> {
  await db.query('UPDATE employees SET office_id = $2, updated_at = now() WHERE id = $1', [
    id,
    officeId,
  ]);
}

/** Learned at a Teams sign-in, so the next one is exact rather than a guess. */
export async function linkEntra(db: Queryable, id: string, objectId: string): Promise<void> {
  await db.query(
    'UPDATE employees SET entra_object_id = $2, updated_at = now() WHERE id = $1 AND entra_object_id IS DISTINCT FROM $2',
    [id, objectId],
  );
}

export async function touchLastSeen(db: Queryable, id: string): Promise<void> {
  await db.query('UPDATE employees SET last_seen_at = now() WHERE id = $1', [id]);
}

export interface PeopleFilter {
  officeId?: string | null;
  search?: string;
  active?: boolean;
  onboarded?: boolean;
  limit?: number;
  offset?: number;
}

export async function listPeople(db: Queryable, filter: PeopleFilter = {}): Promise<Person[]> {
  const where: string[] = [];
  const values: unknown[] = [];
  const add = (clause: string, value: unknown) => {
    values.push(value);
    where.push(clause.replace('?', `$${values.length}`));
  };

  if (filter.officeId !== undefined) {
    if (filter.officeId === null) where.push('office_id IS NULL');
    else add('office_id = ?', filter.officeId);
  }
  if (filter.active !== undefined) add('active = ?', filter.active);
  if (filter.onboarded !== undefined) {
    where.push(filter.onboarded ? 'onboarded_at IS NOT NULL' : 'onboarded_at IS NULL');
  }
  if (filter.search?.trim()) {
    // Escaped, so somebody searching for "50%" is not searching for everyone.
    values.push(
      `%${filter.search
        .trim()
        .toLowerCase()
        .replace(/[%_\\]/g, (c) => `\\${c}`)}%`,
    );
    const p = `$${values.length}`;
    where.push(
      `(lower(display_name) LIKE ${p} OR email LIKE ${p} OR lower(coalesce(department, '')) LIKE ${p})`,
    );
  }

  values.push(filter.limit ?? 200, filter.offset ?? 0);
  const { rows } = await db.query<PersonRow>(
    `SELECT * FROM employees ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY lower(display_name), email
     LIMIT $${values.length - 1} OFFSET $${values.length}`,
    values,
  );
  return rows.map(toPerson);
}

export async function countPeople(
  db: Queryable,
): Promise<{ total: number; active: number; onboarded: number; noOffice: number }> {
  const { rows } = await db.query<{
    total: number;
    active: number;
    onboarded: number;
    no_office: number;
  }>(
    `SELECT count(*)::int AS total,
            count(*) FILTER (WHERE active)::int AS active,
            count(*) FILTER (WHERE active AND onboarded_at IS NOT NULL)::int AS onboarded,
            count(*) FILTER (WHERE active AND office_id IS NULL)::int AS no_office
     FROM employees`,
  );
  const row = rows[0]!;
  return {
    total: row.total,
    active: row.active,
    onboarded: row.onboarded,
    noOffice: row.no_office,
  };
}

/** Everybody who could be seated at this office: active, onboarded, based there. */
export async function listMatchablePeople(db: Queryable, officeId?: string): Promise<Person[]> {
  const { rows } = await db.query<PersonRow>(
    `SELECT * FROM employees
     WHERE active AND onboarded_at IS NOT NULL AND department IS NOT NULL
       AND seniority IS NOT NULL AND office_id IS NOT NULL
       ${officeId ? 'AND office_id = $1' : ''}`,
    officeId ? [officeId] : [],
  );
  return rows.map(toPerson);
}

/**
 * What a directory says about somebody already here. The directory owns their
 * name, title, department and team; what they chose themselves (office,
 * languages, interests, level) is only filled where they have not.
 */
export async function applyDirectoryRecord(
  db: Queryable,
  id: string,
  record: {
    displayName: string;
    title: string;
    department: string | null;
    team: string;
    aliases: string[];
    entraObjectId: string | null;
    officeId: string | null;
    seniority: Seniority | null;
    startedOn: string | null;
  },
): Promise<void> {
  await db.query(
    `UPDATE employees SET display_name = $2, title = $3, department = coalesce($4, department),
       team = $5, aliases = $6, entra_object_id = coalesce($7, entra_object_id),
       office_id = coalesce(office_id, $8), seniority = coalesce(seniority, $9),
       started_on = coalesce($10, started_on), updated_at = now()
     WHERE id = $1`,
    [
      id,
      record.displayName,
      record.title,
      record.department,
      record.team,
      record.aliases.map(normaliseEmail),
      record.entraObjectId,
      record.officeId,
      record.seniority,
      record.startedOn,
    ],
  );
}

/** Everybody a directory brought in, for noticing who has left it. */
export async function listBySource(db: Queryable, source: EmployeeSource): Promise<Person[]> {
  const { rows } = await db.query<PersonRow>(
    'SELECT * FROM employees WHERE source = $1 AND active',
    [source],
  );
  return rows.map(toPerson);
}

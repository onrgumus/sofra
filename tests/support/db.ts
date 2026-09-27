import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { createDb, setDb, type Db } from '../../src/db';
import { createOffice } from '../../src/data/offices';
import { addAllowedDomain, addDepartment } from '../../src/data/settings';
import { createPerson, type NewPerson } from '../../src/data/people';
import type { Office, Person } from '../../src/data/types';

export interface TestDb {
  db: Db;
  schema: string;
  cleanup(): Promise<void>;
}

/**
 * An empty, migrated database of its own for one test file: a fresh schema in
 * the test database, dropped afterwards. Real PostgreSQL, so the SQL under test
 * is the SQL that runs in production.
 */
export async function createTestDb(): Promise<TestDb> {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    throw new Error(
      'TEST_DATABASE_URL is not set. Point it at an empty PostgreSQL database (see .env.test.local).',
    );
  }

  const schema = `t_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
  const admin = new pg.Client({ connectionString: url });
  await admin.connect();
  await admin.query(`CREATE SCHEMA ${schema}`);
  await admin.end();

  const db = createDb({ connectionString: url, schema, max: 5 });
  setDb(db);

  return {
    db,
    schema,
    async cleanup() {
      setDb(undefined);
      await db.end();
      const drop = new pg.Client({ connectionString: url });
      await drop.connect();
      await drop.query(`DROP SCHEMA ${schema} CASCADE`);
      await drop.end();
    },
  };
}

export function officeFixture(overrides: Partial<Office> = {}): Office {
  return {
    id: 'IST',
    name: 'Istanbul HQ',
    address: 'Maslak',
    meetingPoint: 'Ground floor cafeteria',
    timeZone: 'Europe/Istanbul',
    opensAt: '09:00',
    matchLeadMinutes: 180,
    confirmBy: '10:00',
    reminderAt: '16:00',
    lunchSlots: ['12:00'],
    workingDays: [1, 2, 3, 4, 5],
    minTable: 3,
    maxTable: 4,
    locationKeywords: ['istanbul', 'maslak'],
    active: true,
    ...overrides,
  };
}

const DEPARTMENTS = ['Engineering', 'Sales', 'Finance', 'Design', 'People', 'Product', 'Legal'];
const LADDER = ['intern', 'junior', 'mid', 'senior', 'lead', 'manager', 'director'] as const;

/** An office, the departments, the domain, ready for people. */
export async function seedBasics(db: Db, office: Office = officeFixture()): Promise<Office> {
  await addAllowedDomain(db, 'acme.test');
  for (const d of DEPARTMENTS) await addDepartment(db, d);
  return createOffice(db, office);
}

/** An onboarded person in their own team and department, so nothing blocks matching. */
export async function person(
  db: Db,
  index: number,
  overrides: Partial<NewPerson> = {},
): Promise<Person> {
  return createPerson(db, {
    email: `p${index}@acme.test`,
    displayName: `Person ${index}`,
    source: 'seed',
    title: 'Specialist',
    department: DEPARTMENTS[index % DEPARTMENTS.length]!,
    team: `Team ${index}`,
    seniority: LADDER[index % LADDER.length]!,
    officeId: 'IST',
    languages: ['en'],
    onboarded: true,
    ...overrides,
  });
}

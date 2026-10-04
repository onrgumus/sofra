import { createHash, randomInt } from 'node:crypto';
import { demoOpen } from '../auth/demo';
import type { Db } from '../db';
import { listHolidays, listOffices } from '../data/offices';
import { createPerson } from '../data/people';
import { hitRateLimit } from '../data/sessions';
import { listDepartments } from '../data/settings';
import { setRequest } from '../data/lunch';
import { isPlanned, tableOf } from '../data/tables';
import type { Office, Person } from '../data/types';
import { addDays } from '../lib/zoned';
import { phaseOf, wantLunch, type DayDeps } from './days';
import { officeToday, workingDaysFrom } from './schedule';
import { planNow } from './tick';

/** Where guests' addresses live: reserved for testing, so no mail can reach anybody. */
const GUEST_DOMAIN = 'sofra.test';

/** One browser cannot make guests without end, and nor can everybody together. */
const PER_VISITOR = { limit: 6, windowSeconds: 3600 };
const EVERYBODY = { limit: 240, windowSeconds: 3600 };

const GIVEN_NAMES = [
  'Alex',
  'Deniz',
  'Sam',
  'Mira',
  'Kai',
  'Noa',
  'Elif',
  'Jonas',
  'Lena',
  'Omar',
  'Ines',
  'Tomas',
];

export type DemoEntry =
  | { ok: true; guest: Person; seatedOn: string | null }
  | { ok: false; reason: 'closed' | 'busy' | 'no-office' };

/**
 * Lets one visitor in: a new invented colleague of their own, so that what one
 * visitor does never changes what another sees of themselves, already seated
 * at a table on the next day that still takes replies.
 */
export async function enterDemo(deps: DayDeps, visitor: { ip: string }): Promise<DemoEntry> {
  const { db } = deps;
  if (!(await demoOpen(db))) return { ok: false, reason: 'closed' };

  // The address is only ever kept as a digest, and only for the hour it limits.
  const who = createHash('sha256').update(visitor.ip).digest('hex').slice(0, 24);
  if (
    !(await hitRateLimit(db, `demo:${who}`, PER_VISITOR.limit, PER_VISITOR.windowSeconds)) ||
    !(await hitRateLimit(db, 'demo:everybody', EVERYBODY.limit, EVERYBODY.windowSeconds))
  ) {
    return { ok: false, reason: 'busy' };
  }

  const office = (await listOffices(db, { activeOnly: true }))[0];
  if (!office) return { ok: false, reason: 'no-office' };

  const guest = await createGuest(db, office);
  const seatedOn = await seatGuest(deps, guest, office);
  return { ok: true, guest, seatedOn };
}

async function createGuest(db: Db, office: Office): Promise<Person> {
  const departments = await listDepartments(db);
  const tag = randomInt(1000, 10_000);
  return createPerson(db, {
    email: `guest-${Date.now().toString(36)}-${tag}@${GUEST_DOMAIN}`,
    displayName: `${GIVEN_NAMES[randomInt(GIVEN_NAMES.length)]} Guest`,
    title: 'Visitor',
    department: departments.length > 0 ? departments[randomInt(departments.length)]! : null,
    // A team of their own: two guests are not teammates, and may share a table.
    team: `Visitors ${tag}`,
    seniority: 'mid',
    officeId: office.id,
    languages: ['en', 'tr'],
    interests: ['coffee', 'travel'],
    source: 'self',
    onboarded: true,
  });
}

/**
 * Puts a guest at a table straight away, on the first day that still takes
 * replies. A day whose tables are not made yet has them made now, with the
 * guest among those who asked; a day whose tables are all full is made again.
 * The scheduler leaves a day alone once somebody has made its tables. Returns
 * the day, or null if no day in the coming week could seat them.
 */
export async function seatGuest(
  deps: DayDeps,
  guest: Person,
  office: Office,
): Promise<string | null> {
  const { db, now } = deps;
  const today = officeToday(office, now);
  const holidays = new Set(
    (await listHolidays(db, office.id, { from: today, to: addDays(today, 30) })).map((h) => h.date),
  );

  for (const date of workingDaysFrom(office, today, 6, holidays)) {
    const phase = await phaseOf(db, office, date, now);
    if (phase !== 'open' && phase !== 'matched') continue;

    if (await isPlanned(db, office.id, date)) {
      const outcome = await wantLunch(deps, guest, { date, officeId: office.id, slot: null });
      // Every table full: the request is kept, so making the day again seats them.
      if (!outcome.ok && outcome.reason === 'no-seat') await planNow(deps, office, date);
    } else {
      await setRequest(db, {
        employeeId: guest.id,
        date,
        officeId: office.id,
        slot: null,
        source: 'manual',
      });
      await planNow(deps, office, date);
    }

    const table = await tableOf(db, guest.id, date);
    if (table && !table.cancelled) return date;
  }
  return null;
}

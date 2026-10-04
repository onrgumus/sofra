/**
 * Fills an empty database with a synthetic company, for trying Sofra on a
 * laptop: two offices in different time zones, the departments, an allowed
 * mail domain, 240 invented people, some of them asking for lunch over the
 * coming days, and the three weeks of lunches before today.
 *
 *   npm run db:seed            only into an empty database
 *   npm run db:seed -- --reset wipes Sofra's tables first
 *
 * Reads DATABASE_URL from the environment or .env.local. Every address is at
 * sofra.test, a domain reserved for testing, so nothing here can reach a real
 * mailbox.
 */
import { existsSync } from 'node:fs';
import { createDb, type Db } from '../src/db';
import { createOffice, listOffices } from '../src/data/offices';
import { createPerson } from '../src/data/people';
import { setPattern, setRequest } from '../src/data/lunch';
import { addAllowedDomain, addDepartment, setSetting } from '../src/data/settings';
import type { Office, Weekday } from '../src/data/types';
import { createRng } from '../src/core/rng';
import { generateCompany } from '../src/sim/company';
import { addDays, isoWeekday, localNow } from '../src/lib/zoned';
import type { InviteChannel } from '../src/notify/channels';
import { planOfficeDay } from '../src/services/planning';
import { sendEveningReminders } from '../src/services/reminders';
import { matchInstant, reminderInstant } from '../src/services/schedule';

const DOMAIN = 'sofra.test';

const OFFICES: Office[] = [
  {
    id: 'IST-HQ',
    name: 'Istanbul HQ',
    address: 'Maslak, Istanbul',
    meetingPoint: 'Ground floor cafeteria, by the coffee bar',
    timeZone: 'Europe/Istanbul',
    opensAt: '09:00',
    matchLeadMinutes: 180,
    confirmBy: '10:00',
    reminderAt: '16:00',
    lunchSlots: ['12:00', '12:30'],
    workingDays: [1, 2, 3, 4, 5],
    minTable: 3,
    maxTable: 4,
    locationKeywords: ['istanbul', 'maslak'],
    active: true,
  },
  {
    id: 'AMS-1',
    name: 'Amsterdam',
    address: 'Zuidas, Amsterdam',
    meetingPoint: 'Reception, third floor',
    timeZone: 'Europe/Amsterdam',
    opensAt: '08:30',
    matchLeadMinutes: 180,
    confirmBy: '10:00',
    reminderAt: '16:00',
    lunchSlots: ['12:30'],
    workingDays: [1, 2, 3, 4, 5],
    minTable: 3,
    maxTable: 4,
    locationKeywords: ['amsterdam', 'zuidas'],
    active: true,
  },
];

const TABLES = [
  'lunch_tables',
  'lunch_requests',
  'weekly_patterns',
  'request_skips',
  'unseated',
  'job_runs',
  'notifications_sent',
  'mail_outbox',
  'sessions',
  'login_tokens',
  'rate_limit_events',
  'admin_grants',
  'audit_log',
  'teams_conversations',
  'calendar_hints',
  'calendar_fetches',
  'employees',
  'office_holidays',
  'offices',
  'departments',
  'allowed_domains',
  'settings',
];

async function main(): Promise<void> {
  if (existsSync('.env.local')) process.loadEnvFile('.env.local');
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set (environment or .env.local).');

  const db = createDb({ connectionString: url, max: 4 });
  try {
    if (process.argv.includes('--reset')) {
      await db.query(`TRUNCATE ${TABLES.join(', ')} CASCADE`);
      console.log('Wiped every Sofra table.');
    }
    if ((await listOffices(db)).length > 0) {
      console.log('The database already has offices; nothing seeded. Use --reset to start over.');
      return;
    }

    await setSetting(db, 'company_name', 'Acme (demo)');
    await addAllowedDomain(db, DOMAIN);
    for (const office of OFFICES) await createOffice(db, office);

    const company = generateCompany({
      size: 240,
      offices: OFFICES.map((o) => o.id),
      seed: 7,
      officeLanguages: { 'IST-HQ': ['tr', 'en'], 'AMS-1': ['nl', 'en'] },
    });
    for (const d of new Set(company.map((e) => e.department))) await addDepartment(db, d);

    const ids: { id: string; officeId: string }[] = [];
    const used = new Set<string>();
    for (const employee of company) {
      const local = ascii(employee.displayName)
        .toLowerCase()
        .replace(/[^a-z]+/g, '.');
      let email = `${local}@${DOMAIN}`;
      for (let n = 2; used.has(email); n++) email = `${local}${n}@${DOMAIN}`;
      used.add(email);

      const person = await createPerson(db, {
        email,
        displayName: employee.displayName,
        source: 'seed',
        title: employee.title,
        department: employee.department,
        team: employee.team.slice(employee.department.length + 1),
        seniority: employee.seniority,
        officeId: employee.officeId,
        languages: employee.languages,
        interests: employee.interests,
        startedOn: monthsAgo(employee.tenureMonths),
        onboarded: true,
      });
      ids.push({ id: person.id, officeId: employee.officeId });
    }

    // The account to try things as, and the console's first admin: put
    // onur@sofra.test in SOFRA_ADMINS.
    await createPerson(db, {
      email: `onur@${DOMAIN}`,
      displayName: 'Onur Gumus',
      source: 'seed',
      title: 'Digital Transformation Manager',
      department: 'Product',
      team: 'Core Product',
      seniority: 'manager',
      officeId: 'IST-HQ',
      languages: ['tr', 'en'],
      interests: ['running', 'chess', 'live music'],
      startedOn: monthsAgo(41),
      onboarded: true,
    });

    // About a third ask for lunch on each of the next working days, and a few
    // come every Tuesday and Thursday.
    const rng = createRng(11);
    const today = localNow('Europe/Istanbul').date;
    let asked = 0;
    for (let i = 0; i < 12; i++) {
      const date = addDays(today, i);
      if (isoWeekday(date) > 5) continue;
      for (const { id, officeId } of ids) {
        if (rng() < 0.33) {
          await setRequest(db, { employeeId: id, date, officeId, slot: null, source: 'manual' });
          asked++;
        }
      }
    }
    for (const { id } of ids.slice(0, 20)) {
      await setPattern(db, { employeeId: id, weekdays: [2, 4] as Weekday[], slot: null });
    }

    const history = await seedHistory(db, ids, today);

    console.log(
      `Seeded ${OFFICES.length} offices, ${ids.length + 1} people at @${DOMAIN}, ${asked} lunch requests.`,
    );
    console.log(
      `And three weeks behind them: ${history.days} office-days, ${history.tables} tables, every one in Runs.`,
    );
    console.log(`Sign in as onur@${DOMAIN}; with SOFRA_ADMINS=onur@${DOMAIN} that is an admin.`);
  } finally {
    await db.end();
  }
}

/**
 * Three weeks of what already happened, so the console, Runs and the evening
 * question start from a company that has been using Sofra rather than from
 * nothing. Made by the code the scheduler runs, day by day in order, so every
 * table knows who has met before. Nothing is sent: the mail went weeks ago.
 */
async function seedHistory(
  db: Db,
  ids: { id: string; officeId: string }[],
  today: string,
): Promise<{ days: number; tables: number }> {
  const rng = createRng(23);
  const silent: InviteChannel = {
    name: 'seed',
    sendInvite: async () => undefined,
    sendCancellation: async () => undefined,
    sendReminder: async () => undefined,
  };
  let days = 0;
  let tables = 0;

  for (let back = 21; back >= 0; back--) {
    const date = addDays(today, -back);
    for (const office of OFFICES) {
      if (!office.workingDays.includes(isoWeekday(date) as Weekday)) continue;

      // Today's requests are already in, and its tables are the scheduler's to make.
      if (back > 0) {
        for (const { id, officeId } of ids) {
          if (officeId === office.id && rng() < 0.3) {
            await setRequest(db, { employeeId: id, date, officeId, slot: null, source: 'manual' });
          }
        }
      }

      const reminder = await sendEveningReminders(db, silent, office, date);
      await recordRun(db, 'reminder', office.id, date, reminderInstant(office, date, new Set()), {
        ...reminder,
        failed: reminder.failed.length,
      });
      if (back === 0) continue;

      const plan = await planOfficeDay(db, office, date);
      const madeAt = matchInstant(office, date);
      await db.query(
        'UPDATE lunch_tables SET invites_sent_at = $3 WHERE office_id = $1 AND date = $2',
        [office.id, date, madeAt],
      );
      // Most people said they were coming; a few never replied.
      await db.query(
        `UPDATE table_seats s
            SET rsvp = CASE WHEN abs(hashtext(s.employee_id || s.table_id)) % 10 = 0
                            THEN 'pending' ELSE 'accepted' END
           FROM lunch_tables t
          WHERE t.id = s.table_id AND t.office_id = $1 AND t.date = $2`,
        [office.id, date],
      );
      await recordRun(db, 'match', office.id, date, madeAt, {
        ...plan,
        invitesSent: plan.tables,
        unseatedTold: plan.unseated,
        failedToDeliver: 0,
      });
      days++;
      tables += plan.tables;
    }
  }
  // The evening question for the next working day, when its hour has passed: on
  // a Sunday, Monday's went on Friday.
  for (const office of OFFICES) {
    let next = addDays(today, 1);
    while (!office.workingDays.includes(isoWeekday(next) as Weekday)) next = addDays(next, 1);
    const due = reminderInstant(office, next, new Set());
    if (due.getTime() > Date.now()) continue;
    const reminder = await sendEveningReminders(db, silent, office, next);
    await recordRun(db, 'reminder', office.id, next, due, {
      ...reminder,
      failed: reminder.failed.length,
    });
  }

  return { days, tables };
}

/** A scheduled run, as the scheduler would have recorded it at the time. */
async function recordRun(
  db: Db,
  kind: 'match' | 'reminder',
  officeId: string,
  date: string,
  at: Date,
  summary: object,
): Promise<void> {
  await db.query(
    `INSERT INTO job_runs (kind, office_id, run_key, dedupe_key, trigger, status, started_at, finished_at, summary)
     VALUES ($1, $2, $3, $4, 'schedule', 'done', $5, $5::timestamptz + interval '2 seconds', $6)`,
    [kind, officeId, date, `${kind}:${officeId}:${date}`, at, JSON.stringify(summary)],
  );
}

function ascii(name: string): string {
  return name.replace(/ı/g, 'i').normalize('NFKD').replace(/\p{M}/gu, '');
}

function monthsAgo(months: number): string | null {
  if (months <= 0) return null;
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - months, 1))
    .toISOString()
    .slice(0, 10);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});

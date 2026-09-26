/**
 * Walks the whole product against a real PostgreSQL, on a fake clock, from an
 * empty company to a finished lunch:
 *
 *   an admin sets up an office · people sign in with a link and fill in their
 *   profile · they ask for lunch, one by weekly pattern · the evening question
 *   goes to the people it should · the morning tick makes the tables and mails
 *   them, once however often it runs · somebody late takes a free seat · a
 *   drop-out collapses a table and its people are reseated · four replies at the
 *   same instant · the cut-off stops the moving · a clock change does not move
 *   the next day's tables.
 *
 *   TEST_DATABASE_URL=postgresql://... npm run e2e
 *
 * Works in a schema of its own, dropped afterwards. The unit and integration
 * tests prove the pieces; this proves they are wired together.
 */
import { existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { createDb, setDb, type Db } from '../src/db';
import { createOffice } from '../src/data/offices';
import { addAllowedDomain, addDepartment } from '../src/data/settings';
import { saveProfile } from '../src/data/people';
import { setPattern } from '../src/data/lunch';
import { listMail } from '../src/data/messages';
import { listTables } from '../src/data/tables';
import { redeemSignInLink, requestSignInLink } from '../src/auth/signin';
import { EmailChannel } from '../src/notify/channels';
import { OutboxTransport } from '../src/services/mail';
import { runTick } from '../src/services/tick';
import { dropLunch, respond, wantLunch } from '../src/services/days';
import type { Office, Person } from '../src/data/types';
import type { Seniority } from '../src/core/types';

const FROM = 'Sofra <sofra@e2e.test>';
const DEPARTMENTS = ['Engineering', 'Sales', 'Finance', 'Design', 'People', 'Legal'];
const LADDER: Seniority[] = ['junior', 'mid', 'senior', 'lead', 'manager'];

let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
  if (!ok) failures++;
  console.log(`${ok ? '  ✓' : '  ✗'} ${label}${detail ? `  (${detail})` : ''}`);
}

async function main(): Promise<void> {
  if (existsSync('.env.test.local')) process.loadEnvFile('.env.test.local');
  const url = process.env.TEST_DATABASE_URL ?? process.env.E2E_DATABASE_URL;
  if (!url) throw new Error('Set TEST_DATABASE_URL to a PostgreSQL database the run may use.');

  const schema = `e2e_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
  const admin = new pg.Client({ connectionString: url });
  await admin.connect();
  await admin.query(`CREATE SCHEMA ${schema}`);

  const db = createDb({ connectionString: url, schema, max: 8 });
  setDb(db);
  try {
    await walk(db);
  } finally {
    setDb(undefined);
    await db.end();
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
  }

  console.log(failures === 0 ? '\nEverything held.' : `\n${failures} check(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

async function walk(db: Db): Promise<void> {
  const channel = new EmailChannel({ transport: new OutboxTransport(() => db), from: FROM });
  const mail = {
    transport: new OutboxTransport(() => db),
    from: FROM,
    baseUrl: 'https://sofra.e2e.test',
  };
  const at = (iso: string) => ({ db, channel, from: FROM, now: new Date(iso) });
  const tick = (iso: string) => runTick({ db, channel, from: FROM, now: new Date(iso) });

  console.log('An admin sets up the company');
  const office: Office = {
    id: 'AMS',
    name: 'Amsterdam',
    address: 'Zuidas',
    meetingPoint: 'Reception',
    timeZone: 'Europe/Amsterdam',
    opensAt: '08:30',
    matchLeadMinutes: 180,
    confirmBy: '10:00',
    reminderAt: '16:00',
    lunchSlots: ['12:30'],
    workingDays: [1, 2, 3, 4, 5],
    minTable: 3,
    maxTable: 4,
    locationKeywords: ['amsterdam'],
    active: true,
  };
  await createOffice(db, office);
  await addAllowedDomain(db, 'e2e.test');
  for (const d of DEPARTMENTS) await addDepartment(db, d);
  check('office, domain and departments exist', true);

  console.log('Eleven people sign in by link and fill in their profile');
  const people: Person[] = [];
  for (let i = 0; i < 11; i++) {
    const email = `person${i}@e2e.test`;
    await requestSignInLink(db, mail, { email, meta: { ip: `10.0.0.${i}`, userAgent: 'e2e' } });
    const [link] = await listMail(db, { recipient: email });
    const token = link?.text.match(/token=([\w-]+)/)?.[1] ?? '';
    const session = await redeemSignInLink(db, token, { ip: `10.0.0.${i}`, userAgent: 'e2e' });
    if (!session) throw new Error(`sign-in failed for ${email}`);
    people.push(
      await saveProfile(db, session.person.id, {
        displayName: `Person ${i}`,
        title: 'Specialist',
        department: DEPARTMENTS[i % DEPARTMENTS.length]!,
        team: `Team ${i}`,
        seniority: LADDER[i % LADDER.length]!,
        officeId: 'AMS',
        languages: ['en'],
        interests: i % 2 ? ['chess'] : ['cycling'],
        startedOn: null,
      }),
    );
  }
  check(
    'everybody signed in and is set up',
    people.every((p) => p.onboardedAt !== null),
  );

  // Monday 2026-10-19, Amsterdam on summer time (UTC+2).
  const DAY = '2026-10-19';
  console.log(`Ten ask for lunch on ${DAY}, one of them by weekly pattern`);
  for (const p of people.slice(0, 9)) {
    await wantLunch(at('2026-10-15T09:00:00Z'), p, { date: DAY, officeId: 'AMS', slot: null });
  }
  await setPattern(db, { employeeId: people[9]!.id, weekdays: [1], slot: null });

  console.log('The evening before (Friday 16:00 local) the question goes out');
  // Person 10 had lunch the week before, so is somebody worth asking.
  await wantLunch(at('2026-10-09T09:00:00Z'), people[10]!, {
    date: '2026-10-12',
    officeId: 'AMS',
    slot: null,
  });
  const reminder = (await tick('2026-10-16T14:00:00Z')).find((a) => a.kind === 'reminder');
  check('reminder ran for Monday', reminder?.date === DAY && reminder.status === 'done');
  check(
    'asked only somebody who ate recently and has not answered',
    (reminder?.summary as { asked?: number } | undefined)?.asked === 1,
    JSON.stringify(reminder?.summary),
  );

  console.log('Monday 05:30 local (03:30 UTC): the tables are made');
  check(
    'nothing a minute early',
    (await tick('2026-10-19T03:29:00Z')).filter((a) => a.kind === 'match').length === 0,
  );
  const matched = (await tick('2026-10-19T03:30:00Z')).find((a) => a.kind === 'match');
  const summary = matched?.summary as { seated?: number; tables?: number; invitesSent?: number };
  check(
    'ten seated at three tables',
    summary?.seated === 10 && summary?.tables === 3,
    JSON.stringify(summary),
  );
  const invites = (await listMail(db, { limit: 200 })).filter((m) => m.attachments.length > 0);
  check(
    'one mail per table, each with a calendar invite',
    invites.length === 3 &&
      invites.every((m) => m.attachments[0]?.content.includes('BEGIN:VEVENT')),
  );

  console.log('The scheduler runs again, and again, and twice at once');
  await Promise.all([
    tick('2026-10-19T03:45:00Z'),
    tick('2026-10-19T03:45:00Z'),
    tick('2026-10-19T04:00:00Z'),
  ]);
  const again = (await listMail(db, { limit: 200 })).filter((m) => m.attachments.length > 0);
  check('no second invite to anybody', again.length === 3);

  console.log('06:15: a drop-out leaves a table of three with two');
  const tables = await listTables(db, 'AMS', DAY);
  const small = tables.find((x) => x.members.length === 3)!;
  const leaver = people.find((p) => p.id === small.members[0]!.id)!;
  await dropLunch(at('2026-10-19T04:15:00Z'), leaver, DAY);
  const after = await listTables(db, 'AMS', DAY);
  const collapsed = after.find((x) => x.id === small.id)!;
  const seatedNow = after.filter((x) => !x.cancelled).flatMap((x) => x.members.map((m) => m.id));
  check('the small table is cancelled', collapsed.cancelled);
  check(
    'the two left behind are seated elsewhere',
    small.members.slice(1).every((m) => seatedNow.includes(m.id)),
  );

  console.log('07:15: somebody late takes a free seat');
  const late = await wantLunch(at('2026-10-19T05:15:00Z'), people[10]!, {
    date: DAY,
    officeId: 'AMS',
    slot: null,
  });
  check('the latecomer is seated', late.ok && late.seated != null);

  console.log('07:30: four people reply at the same instant');
  const open = after
    .filter((x) => !x.cancelled)
    .flatMap((x) => x.members.map((m) => ({ table: x.id, id: m.id })));
  await Promise.all(
    open.slice(0, 4).map((seat) =>
      respond(
        at('2026-10-19T05:30:00Z'),
        people.find((p) => p.id === seat.id)!,
        seat.table,
        'accepted',
      ),
    ),
  );
  const replies = (await listTables(db, 'AMS', DAY)).flatMap((x) => Object.entries(x.rsvps));
  check(
    'all four replies recorded',
    open.slice(0, 4).every((s) => replies.some(([id, r]) => id === s.id && r === 'accepted')),
  );

  console.log('10:30: past the cut-off, nothing moves');
  const closed = await wantLunch(at('2026-10-19T08:30:00Z'), people[9]!, {
    date: DAY,
    officeId: 'AMS',
    slot: null,
  });
  check('a late request is refused as closed', !closed.ok && closed.reason === 'closed');

  console.log('Next Monday, after the clocks went back (UTC+1)');
  for (const p of people.slice(0, 3)) {
    await wantLunch(at('2026-10-20T09:00:00Z'), p, {
      date: '2026-10-26',
      officeId: 'AMS',
      slot: null,
    });
  }
  check(
    'nothing at the old summer instant',
    (await tick('2026-10-26T03:30:00Z')).filter((a) => a.kind === 'match').length === 0,
  );
  const winter = (await tick('2026-10-26T04:30:00Z')).find((a) => a.kind === 'match');
  check(
    'tables at 05:30 local, 04:30 UTC',
    winter?.status === 'done' && winter.date === '2026-10-26',
  );
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});

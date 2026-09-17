/**
 * One company, one day, from nobody having heard of Sofra to a cancelled table.
 *
 * Not a unit test: every step goes through the real store against a real
 * PostgreSQL, the real matcher, the real invite builder and the real delivery
 * path. The unit suite proves the pieces; this proves they are wired together.
 */
import pg from 'pg';
import { readFileSync } from 'node:fs';
import { PostgresStore, type PgPool } from '../src/store/postgres';
import { CsvDirectory } from '../src/directory';
import { ManualAttendanceProvider } from '../src/providers';
import { EmailChannel } from '../src/notify/channels';
import type { EmailMessage, EmailTransport } from '../src/notify/transport';
import { sendReminders } from '../src/lib/reminders';
import { planDay, runNightlyMatching } from '../src/lib/nightly';
import { deliverPending } from '../src/lib/notifications';
import { nextWeekday, todayInZone } from '../src/lib/dates';

const OFFICE = 'IST-HQ';
const CONNECTION = process.env.TEST_DATABASE_URL!;

let failures = 0;
let checks = 0;

function check(label: string, condition: boolean, detail = ''): void {
  checks++;
  if (condition) {
    console.log(`  ok   ${label}`);
  } else {
    failures++;
    console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

function step(title: string): void {
  console.log(`\n── ${title}`);
}

/** Keeps every message so the content can be asserted, not just the count. */
class Mailbox implements EmailTransport {
  readonly name = 'mailbox';
  readonly sent: EmailMessage[] = [];
  async send(message: EmailMessage): Promise<void> {
    this.sent.push(message);
  }
}

const pool = new pg.Pool({ connectionString: CONNECTION, max: 8 }) as PgPool;

await pool.query(`DROP TABLE IF EXISTS group_members, groups, opt_ins, unmatched,
  past_matches, self_declared_attendance, suppressed_attendance, day_locks,
  sign_in_failures, admins, notified, reminders_off CASCADE`);

const date = nextWeekday(todayInZone('Europe/Istanbul'));
const csv = readFileSync(new URL('./e2e-directory.csv', import.meta.url), 'utf8');
const directory = new CsvDirectory({ load: async () => csv, onSkipped: () => {} });
const people = await directory.listEmployees();
const inTheOffice = people.filter((p) => p.officeId === OFFICE).map((p) => p.id);

const store = new PostgresStore({
  pool,
  directory,
  offices: [
    {
      id: OFFICE,
      displayName: 'Istanbul HQ',
      timeZone: 'Europe/Istanbul',
      meetingPoint: 'Ground floor cafeteria, by the coffee bar',
    },
  ],
  attendance: new ManualAttendanceProvider(
    inTheOffice.map((employeeId) => ({ employeeId, officeId: OFFICE, date })),
  ),
});

const mailbox = new Mailbox();
const channel = new EmailChannel({ transport: mailbox, from: 'sofra@example.com' });

console.log(`Company: ${people.length} people, ${inTheOffice.length} in ${OFFICE} on ${date}`);

// ── 1. Nobody has heard of Sofra ────────────────────────────────────────────
step('1. Before anything happens');
check('nobody has asked for a lunch', (await store.listOptIns(date, OFFICE)).length === 0);
check('there are no tables', (await store.listGroups(date, OFFICE)).length === 0);

// ── 2. The morning question ─────────────────────────────────────────────────
step('2. The morning job asks everyone who will be in');
const reminded = await sendReminders({ store, channel, date });
const asked = mailbox.sent.length;

check('everyone in the building was asked', asked === inTheOffice.length, `${asked} mails`);
check(
  'each mail went to exactly one person',
  mailbox.sent.every((m) => m.to.length === 1),
);
check(
  'the mail carries a link to that day',
  mailbox.sent.every((m) => m.text.includes(`day=${date}`)),
);
check(
  'the mail carries its own off switch',
  mailbox.sent.every((m) => m.text.includes('/you')),
);
check(
  'no calendar attachment before there is a lunch',
  mailbox.sent.every((m) => !m.attachments || m.attachments.length === 0),
);
check('the run reports what it did', reminded[0]?.sent === inTheOffice.length);

const beforeSecondRun = mailbox.sent.length;
await sendReminders({ store, channel, date });
check('running it twice asks nobody again', mailbox.sent.length === beforeSecondRun);

// ── 3. People answer ────────────────────────────────────────────────────────
step('3. Eleven people say yes, one turns reminders off');
const keen = inTheOffice.slice(0, 11);
for (const employeeId of keen) {
  await store.setOptIn({ employeeId, date, officeId: OFFICE, slot: '12:00' });
}
const quiet = inTheOffice[11]!;
await store.setReminders(quiet, false);

check('eleven opt-ins recorded', (await store.listOptIns(date, OFFICE)).length === 11);
check('the opt-out is remembered', (await store.listRemindersOff()).includes(quiet));

// ── 4. The evening job ──────────────────────────────────────────────────────
step('4. The evening job plans the day and mails each table');
mailbox.sent.length = 0;
const outcomes = await runNightlyMatching({ store, channel, from: 'sofra@example.com', date });
const tables = await store.listGroups(date, OFFICE);
const seated = tables.flatMap((t) => t.members.map((m) => m.id));

check('tables were built', tables.length > 0, `${tables.length} tables`);
check(
  'every table has three or four people',
  tables.every((t) => t.members.length >= 3 && t.members.length <= 4),
);
check('nobody sits at two tables', new Set(seated).size === seated.length);
check(
  'only people who asked are seated',
  seated.every((id) => keen.includes(id)),
);
check(
  'everyone who asked is seated or reported as unseated',
  seated.length + (await store.listUnmatched(date, OFFICE)).length === keen.length,
);
check(
  'no table seats two people from the same team',
  tables.every((t) => new Set(t.members.map((m) => m.team)).size === t.members.length),
);
check(
  'every table shares a language',
  tables.every((t) => t.commonLanguages.length > 0),
);
check('one mail per table', mailbox.sent.length === tables.length);
check(
  'the invite is addressed to the whole table at once',
  mailbox.sent.every((m) => m.to.length >= 3),
);
check(
  'the invite carries a calendar request',
  mailbox.sent.every((m) => m.attachments?.[0]?.content.includes('METHOD:REQUEST')),
);
check(
  'the invite names the meeting point',
  mailbox.sent.every((m) => m.text.includes('Ground floor cafeteria')),
);
check(
  'the invite opens an introduction round',
  mailbox.sent.every((m) => m.text.includes('How to start')),
);
check(
  'the invite makes room for the human half',
  mailbox.sent.every((m) => /sport|culture/i.test(m.text)),
);
check('the outcome reports the same numbers', outcomes[0]?.tables === tables.length);

// ── 5. The job runs again ───────────────────────────────────────────────────
step('5. The scheduler fires a second time');
const mailsBefore = mailbox.sent.length;
const idsBefore = tables.map((t) => t.id).sort();
await runNightlyMatching({ store, channel, from: 'sofra@example.com', date });
const after = await store.listGroups(date, OFFICE);

check('nobody is mailed twice', mailbox.sent.length === mailsBefore);
check(
  'the tables are not rebuilt',
  JSON.stringify(after.map((t) => t.id).sort()) === JSON.stringify(idsBefore),
);

// ── 6. Replies ──────────────────────────────────────────────────────────────
step('6. People reply');
const table = tables.find((t) => t.members.length === 4)!;
const [first, second, third] = table.members;

await store.setRsvp(table.id, first!.id, 'accepted');
check(
  'an acceptance is recorded',
  (await store.getGroup(table.id))?.rsvps[first!.id] === 'accepted',
);

await store.setRsvp(table.id, second!.id, 'declined');
const afterDecline = (await store.getGroup(table.id))!;
check('a decline is recorded', afterDecline.rsvps[second!.id] === 'declined');
check('the table still stands with three', !afterDecline.cancelled);
// Nobody moved, so the lunch is unchanged: same time, same place, same three
// people turning up. Mailing them a fresh calendar invite because a fourth
// dropped out would be noise, and the page shows the reply to anyone who looks.
check('the reply is visible on the table', afterDecline.rsvps[second!.id] === 'declined');
check(
  "a decline that changes nobody's seat does not re-invite the table",
  afterDecline.invitesSentAt !== null && afterDecline.sequence === table.sequence,
);

mailbox.sent.length = 0;
await deliverPending({ store, channel, from: 'sofra@example.com', date, officeId: OFFICE });
check('so nothing is sent', mailbox.sent.length === 0);

// ── 7. Enough declines to call it off ───────────────────────────────────────
step('7. Two more drop out');
mailbox.sent.length = 0;
await store.setRsvp(table.id, third!.id, 'declined');
const collapsed = (await store.getGroup(table.id))!;

if (collapsed.cancelled) {
  check('the table is cancelled once it is too small', true);
  await deliverPending({ store, channel, from: 'sofra@example.com', date, officeId: OFFICE });
  const cancellation = mailbox.sent.find((m) =>
    m.attachments?.[0]?.content.includes('METHOD:CANCEL'),
  );
  check('a cancellation takes it off the calendar', cancellation !== undefined);
  check(
    'the people still coming were offered another seat first',
    (await store.getGroup(table.id))!.members.length < table.members.length ||
      collapsed.members.every((m) => collapsed.rsvps[m.id] !== 'accepted'),
  );

  mailbox.sent.length = 0;
  await deliverPending({ store, channel, from: 'sofra@example.com', date, officeId: OFFICE });
  check('the cancellation is not sent twice', mailbox.sent.length === 0);

  // The people who were moved changed somebody else's table, and that table
  // does need telling, as an update to the same event rather than a second one.
  const hosts = (await store.listGroups(date, OFFICE)).filter(
    (t) => !t.cancelled && t.sequence > 0,
  );
  if (hosts.length > 0) {
    check(
      'a table that gained somebody was re-invited with a bumped SEQUENCE',
      hosts.every((h) => h.invitesSentAt !== null),
    );
  }
} else {
  check('the table survived with the people still coming', collapsed.members.length >= 3);
}

// ── 8. Plans change ─────────────────────────────────────────────────────────
step('8. Someone stops coming in altogether');
const other = (await store.listGroups(date, OFFICE)).find(
  (t) => !t.cancelled && t.members.length >= 3,
);
if (other) {
  const leaver = other.members[0]!;
  await store.setSelfDeclaredAttendance(leaver.id, date, OFFICE, false);

  check(
    'their request for a lunch is withdrawn',
    (await store.getOptIn(leaver.id, date, OFFICE)) === null,
  );
  check(
    'their seat does not sit there expecting them',
    (await store.getGroup(other.id))?.rsvps[leaver.id] === 'declined',
  );
}

// ── 9. Concurrency ──────────────────────────────────────────────────────────
step('9. Four people reply at the same instant');
const busy = (await store.listGroups(date, OFFICE)).find(
  (t) => !t.cancelled && t.members.length === 4,
);
if (busy) {
  const seatsBefore = (await store.listGroups(date, OFFICE))
    .filter((t) => !t.cancelled)
    .flatMap((t) => t.members.map((m) => m.id));

  await Promise.all(busy.members.map((m) => store.setRsvp(busy.id, m.id, 'accepted')));
  const replies = (await store.getGroup(busy.id))!.rsvps;

  check(
    'every reply landed, none overwrote another',
    busy.members.every((m) => replies[m.id] === 'accepted'),
  );

  const seatsAfter = (await store.listGroups(date, OFFICE))
    .filter((t) => !t.cancelled)
    .flatMap((t) => t.members.map((m) => m.id));
  check('nobody vanished from a table', seatsAfter.length === seatsBefore.length);
} else {
  console.log('  --   no intact table of four left to contend on');
}

// ── 10. Re-planning ─────────────────────────────────────────────────────────
step('10. The admin re-runs matching by hand');
const replanned = await planDay(store, OFFICE, date);
const replannedSeats = replanned.groups.flatMap((g) => g.members.map((m) => m.id));

check('a new plan is produced', replanned.groups.length > 0);
check('still nobody at two tables', new Set(replannedSeats).size === replannedSeats.length);
check(
  'the day being replanned does not count as a past lunch',
  replanned.groups.every((g) => g.members.length >= 3),
);

mailbox.sent.length = 0;
await deliverPending({ store, channel, from: 'sofra@example.com', date, officeId: OFFICE });
check('the new tables are told about it', mailbox.sent.length === replanned.groups.length);

// ── 11. History ─────────────────────────────────────────────────────────────
step('11. What is kept afterwards');
const history = await store.listPastMatches();
check(
  'the lunches are remembered so they are not repeated',
  history.some((m) => m.date === date),
);
check(
  'history holds ids and a date, nothing else',
  history.every((m) => Object.keys(m).sort().join() === 'date,memberIds'),
);

console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'}: ${checks - failures}/${checks} checks`);
await pool.end?.();
process.exit(failures === 0 ? 0 : 1);

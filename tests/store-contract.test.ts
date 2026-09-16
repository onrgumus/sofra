import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DemoStore, SLOT } from '../src/store/demo';
import { SqliteStore } from '../src/store/sqlite';
import { PostgresStore, type PgPool } from '../src/store/postgres';
import { newDb } from 'pg-mem';
import pg from 'pg';
import type { Store } from '../src/store/types';
import { planDay } from '../src/lib/nightly';
import { todayInZone, upcomingWeekdays } from '../src/lib/dates';

const OFFICE = 'IST-HQ';

/**
 * One suite, both implementations.
 *
 * The point is not coverage, it is agreement: the in-memory store is what every
 * other test runs against, so if the database-backed one behaves differently
 * anywhere here, one of them is wrong and the interface was hiding it.
 */
interface Subject {
  name: string;
  make: () => Promise<Store>;
  cleanUp: () => void;
  /**
   * Whether this subject can actually demonstrate that concurrent writes are
   * serialised. pg-mem parses FOR UPDATE and never contends on it, so the
   * Postgres subject proves the statements and the logic but not the lock.
   */
  serialisesConcurrentWrites?: boolean;
}

const directory = mkdtempSync(join(tmpdir(), 'sofra-'));

/**
 * A real server when one is reachable, pg-mem otherwise.
 *
 * pg-mem parses the real dialect in process, which catches the SQL mistakes a
 * port makes, but it is single-threaded: it accepts FOR UPDATE and never
 * contends on it, so it cannot show that concurrent replies are serialised.
 * Point TEST_DATABASE_URL at a server and that case runs for real.
 */
const REAL_POSTGRES = process.env.TEST_DATABASE_URL;

function postgresPool(): PgPool {
  if (REAL_POSTGRES) return new pg.Pool({ connectionString: REAL_POSTGRES, max: 8 }) as PgPool;
  const { Pool } = newDb().adapters.createPg() as { Pool: new () => PgPool };
  return new Pool();
}

/** Each run needs its own tables when they all share one server. */
async function freshSchema(pool: PgPool): Promise<void> {
  if (!REAL_POSTGRES) return;
  // Every table, not the interesting ones: a leftover `sign_in_failures` row
  // from the previous run makes the throttle case fail on the second run and
  // pass on the first, which is the worst way for a test to be wrong.
  await pool.query(`DROP TABLE IF EXISTS group_members, groups, opt_ins, unmatched,
    past_matches, self_declared_attendance, suppressed_attendance, day_locks,
    sign_in_failures, admins, notified, reminders_off CASCADE`);
}

const subjects: Subject[] = [
  {
    name: 'DemoStore',
    make: async () => new DemoStore(7, 160),
    cleanUp: () => {},
    serialisesConcurrentWrites: true,
  },
  {
    name: 'PostgresStore',
    make: async () => {
      const seed = new DemoStore(7, 160);
      const world = seed.world();
      const pool = postgresPool();
      await freshSchema(pool);
      const store = new PostgresStore({
        pool,
        employees: world.employees,
        offices: world.offices,
        attendance: world.attendance,
      });
      await store.recordPastMatches(world.history);
      for (const optIn of world.optIns) await store.setOptIn(optIn);
      return store;
    },
    cleanUp: () => {},
    // pg-mem cannot show this; a real server can. See postgresPool above.
    serialisesConcurrentWrites: REAL_POSTGRES !== undefined,
  },
  {
    name: 'SqliteStore',
    make: async () => {
      const seed = new DemoStore(7, 160);
      const world = seed.world();
      const store = new SqliteStore({
        path: join(directory, `contract-${Math.random().toString(36).slice(2)}.db`),
        employees: world.employees,
        offices: world.offices,
        attendance: world.attendance,
      });
      store.recordPastMatches(world.history);
      for (const optIn of world.optIns) await store.setOptIn(optIn);
      return store;
    },
    cleanUp: () => {},
    serialisesConcurrentWrites: true,
  },
];

describe.each(subjects)('$name', (subject) => {
  let store: Store;
  let date: string;

  beforeEach(async () => {
    store = await subject.make();
    date = upcomingWeekdays(1, todayInZone('Europe/Istanbul'))[0]!;
  });

  afterEach(() => subject.cleanUp());

  it('knows the offices and the people', async () => {
    expect((await store.listOffices()).length).toBeGreaterThan(0);
    expect(await store.listEmployees()).toHaveLength(160);
    expect((await store.getEmployee('onur'))?.displayName).toBe('Onur GG');
  });

  it('reports the desk feed as the source of an office day', async () => {
    const attending = await store.getAttendance(date, OFFICE);
    expect(attending.length).toBeGreaterThan(0);
    expect(await store.attendanceSource(attending[0]!, date, OFFICE)).toBe('desk-booking');
  });

  it('lets someone declare a day the feed does not know about', async () => {
    const attending = new Set(await store.getAttendance(date, OFFICE));
    const absent = (await store.listEmployees(OFFICE)).find((e) => !attending.has(e.id))!;

    await store.setSelfDeclaredAttendance(absent.id, date, OFFICE, true);

    expect(await store.attendanceSource(absent.id, date, OFFICE)).toBe('self-declared');
    expect(await store.getAttendance(date, OFFICE)).toContain(absent.id);
  });

  it('lets someone override the feed when plans change', async () => {
    const [booked] = await store.getAttendance(date, OFFICE);
    await store.setSelfDeclaredAttendance(booked!, date, OFFICE, false);

    expect(await store.getAttendance(date, OFFICE)).not.toContain(booked);
    expect(await store.attendanceSource(booked!, date, OFFICE)).toBeNull();
  });

  it('drops the lunch request when someone stops coming in', async () => {
    const [booked] = await store.getAttendance(date, OFFICE);
    await store.setOptIn({ employeeId: booked!, date, officeId: OFFICE, slot: SLOT });
    expect(await store.getOptIn(booked!, date, OFFICE)).not.toBeNull();

    await store.setSelfDeclaredAttendance(booked!, date, OFFICE, false);
    expect(await store.getOptIn(booked!, date, OFFICE)).toBeNull();
  });

  it('records and removes a lunch request', async () => {
    const [someone] = await store.getAttendance(date, OFFICE);
    await store.setOptIn({ employeeId: someone!, date, officeId: OFFICE, slot: SLOT });
    expect((await store.listOptIns(date, OFFICE)).some((o) => o.employeeId === someone)).toBe(true);

    await store.removeOptIn(someone!, date, OFFICE);
    expect((await store.listOptIns(date, OFFICE)).some((o) => o.employeeId === someone)).toBe(
      false,
    );
  });

  it('stores a plan with everyone pending a reply', async () => {
    await planDay(store, OFFICE, date);
    const groups = await store.listGroups(date, OFFICE);

    expect(groups.length).toBeGreaterThan(0);
    for (const group of groups) {
      expect(Object.values(group.rsvps).every((s) => s === 'pending')).toBe(true);
      expect(group.invitesSentAt).toBeNull();
      expect(group.cancelled).toBe(false);
      expect(group.members.length).toBeGreaterThanOrEqual(3);
    }
  });

  it('finds the table a person was seated at', async () => {
    await planDay(store, OFFICE, date);
    const group = (await store.listGroups(date, OFFICE))[0]!;
    const member = group.members[0]!;

    expect((await store.groupForEmployee(member.id, date, OFFICE))?.id).toBe(group.id);
  });

  it('replaces the plan when the day is matched again', async () => {
    await planDay(store, OFFICE, date);
    const first = (await store.listGroups(date, OFFICE)).length;
    await planDay(store, OFFICE, date);

    expect(await store.listGroups(date, OFFICE)).toHaveLength(first);
  });

  it('remembers that an invite was sent', async () => {
    await planDay(store, OFFICE, date);
    const group = (await store.listGroups(date, OFFICE))[0]!;

    await store.markInviteSent(group.id);
    expect((await store.getGroup(group.id))?.invitesSentAt).not.toBeNull();

    await store.markCancellationSent(group.id);
    expect((await store.getGroup(group.id))?.cancellationSentAt).not.toBeNull();
  });

  it('records a reply', async () => {
    await planDay(store, OFFICE, date);
    const group = (await store.listGroups(date, OFFICE)).find((g) => g.members.length === 4)!;
    const member = group.members[0]!;

    await store.setRsvp(group.id, member.id, 'accepted');
    expect((await store.getGroup(group.id))?.rsvps[member.id]).toBe('accepted');
  });

  it('moves the people still coming when a table collapses', async () => {
    await planDay(store, OFFICE, date);
    const group = (await store.listGroups(date, OFFICE)).find((g) => g.members.length === 4)!;
    const [outA, outB, stayer] = group.members;

    await store.setRsvp(group.id, stayer!.id, 'accepted');
    await store.setRsvp(group.id, outA!.id, 'declined');
    await store.setRsvp(group.id, outB!.id, 'declined');

    expect((await store.getGroup(group.id))?.cancelled).toBe(true);

    const moved = await store.groupForEmployee(stayer!.id, date, OFFICE);
    expect(moved).not.toBeNull();
    expect(moved!.id).not.toBe(group.id);
    // The reply carries across; nobody is asked to confirm twice.
    expect(moved!.rsvps[stayer!.id]).toBe('accepted');
    // And the receiving table needs its invite again, as an update.
    expect(moved!.invitesSentAt).toBeNull();
    expect(moved!.sequence).toBeGreaterThan(0);
  });

  it('seats every opted-in person exactly once', async () => {
    const result = await planDay(store, OFFICE, date);
    const groups = await store.listGroups(date, OFFICE);
    const seated = groups.flatMap((g) => g.members.map((m) => m.id));

    expect(new Set(seated).size).toBe(seated.length);
    expect(seated).toHaveLength(result.groups.reduce((n, g) => n + g.members.length, 0));
  });

  it.runIf(subject.serialisesConcurrentWrites)(
    'survives a whole table replying at the same moment',
    async () => {
      // A reply is a read-modify-write across every table that day, because a
      // decline can move people between them. Without a transaction each reply
      // reads state the others have not written yet and the last one wins: the
      // collapse silently did not happen.
      await planDay(store, OFFICE, date);
      const table = (await store.listGroups(date, OFFICE)).find((g) => g.members.length === 4)!;
      const before = (await store.listGroups(date, OFFICE)).flatMap((g) =>
        g.members.map((m) => m.id),
      );

      await Promise.all(
        table.members.map((m, i) => store.setRsvp(table.id, m.id, i < 2 ? 'declined' : 'accepted')),
      );

      const after = await store.listGroups(date, OFFICE);
      const seats = after.flatMap((g) => g.members.map((m) => m.id));

      expect(after.filter((g) => g.cancelled)).toHaveLength(1);
      expect(new Set(seats).size).toBe(seats.length);
      expect(before.filter((id) => !seats.includes(id))).toEqual([]);
    },
  );

  it('takes the seat back when someone stops coming in', async () => {
    // Not coming in is not coming to lunch. Leaving the seat behind meant three
    // people kept expecting somebody who had already said they would not be
    // there.
    await planDay(store, OFFICE, date);
    const table = (await store.listGroups(date, OFFICE)).find((g) => g.members.length === 4)!;
    const leaver = table.members[0]!;

    await store.setSelfDeclaredAttendance(leaver.id, date, OFFICE, false);

    expect(await store.getOptIn(leaver.id, date, OFFICE)).toBeNull();
    const seat = await store.getGroup(table.id);
    expect(seat?.rsvps[leaver.id]).toBe('declined');
  });

  it('collapses a table when enough people stop coming in', async () => {
    await planDay(store, OFFICE, date);
    const table = (await store.listGroups(date, OFFICE)).find((g) => g.members.length === 4)!;

    await store.setSelfDeclaredAttendance(table.members[0]!.id, date, OFFICE, false);
    await store.setSelfDeclaredAttendance(table.members[1]!.id, date, OFFICE, false);

    expect((await store.getGroup(table.id))?.cancelled).toBe(true);
  });

  it('counts failed sign-ins, and forgets them once one works', async () => {
    // In the store rather than in memory: a counter that resets on a cold start
    // and is per-instance besides is barely a speed bump on a serverless host.
    expect(await store.countSignInFailures('signin:onur', '2000-01-01T00:00:00.000Z')).toBe(0);

    await store.recordSignInFailure('signin:onur', new Date().toISOString());
    await store.recordSignInFailure('signin:onur', new Date().toISOString());
    expect(await store.countSignInFailures('signin:onur', '2000-01-01T00:00:00.000Z')).toBe(2);

    // Somebody else's attempts are not yours.
    expect(await store.countSignInFailures('signin:other', '2000-01-01T00:00:00.000Z')).toBe(0);

    await store.clearSignInFailures('signin:onur');
    expect(await store.countSignInFailures('signin:onur', '2000-01-01T00:00:00.000Z')).toBe(0);
  });

  it('ignores attempts older than the window', async () => {
    const old = new Date(Date.now() - 60 * 60_000).toISOString();
    await store.recordSignInFailure('signin:onur', old);

    const since = new Date(Date.now() - 15 * 60_000).toISOString();
    expect(await store.countSignInFailures('signin:onur', since)).toBe(0);
  });

  it('remembers who was already asked about a day, and who was not', async () => {
    // The reminder is the one message that goes to somebody who never asked for
    // anything. Sending it twice about the same lunch is the difference between
    // a useful nudge and the thing people set up a mail rule for.
    expect(await store.listNotified('reminder', date, OFFICE)).toEqual([]);

    await store.recordNotified('reminder', date, OFFICE, ['e0001', 'e0002']);
    expect(new Set(await store.listNotified('reminder', date, OFFICE))).toEqual(
      new Set(['e0001', 'e0002']),
    );

    // Recording the same person again is not an error and does not duplicate.
    await store.recordNotified('reminder', date, OFFICE, ['e0001']);
    expect(await store.listNotified('reminder', date, OFFICE)).toHaveLength(2);

    // Scoped to the day, the office and the kind of message.
    expect(await store.listNotified('reminder', '2999-01-01', OFFICE)).toEqual([]);
    expect(await store.listNotified('something-else', date, OFFICE)).toEqual([]);
  });

  it('records an empty send without complaining', async () => {
    // Every office where nobody needs asking takes this path, and an INSERT
    // built from an empty list is not valid SQL.
    await store.recordNotified('reminder', date, OFFICE, []);
    expect(await store.listNotified('reminder', date, OFFICE)).toEqual([]);
  });

  it('honours an opt-out, and lets it be taken back', async () => {
    expect(await store.listRemindersOff()).toEqual([]);

    await store.setReminders('e0001', false);
    expect(await store.listRemindersOff()).toEqual(['e0001']);

    // Turning it off twice leaves one row, not two.
    await store.setReminders('e0001', false);
    expect(await store.listRemindersOff()).toEqual(['e0001']);

    await store.setReminders('e0001', true);
    expect(await store.listRemindersOff()).toEqual([]);
  });

  it('grants and revokes the console as data', async () => {
    const at = new Date().toISOString();
    expect(await store.listAdmins()).toEqual([]);

    await store.grantAdmin({ employeeId: 'e0001', grantedBy: 'onur', grantedAt: at });
    expect(await store.listAdmins()).toEqual([
      { employeeId: 'e0001', grantedBy: 'onur', grantedAt: at },
    ]);

    // Granting again re-records who and when rather than failing.
    const later = new Date(Date.now() + 1000).toISOString();
    await store.grantAdmin({ employeeId: 'e0001', grantedBy: 'e0002', grantedAt: later });
    expect(await store.listAdmins()).toEqual([
      { employeeId: 'e0001', grantedBy: 'e0002', grantedAt: later },
    ]);

    await store.revokeAdmin('e0001');
    expect(await store.listAdmins()).toEqual([]);
  });

  it('forgets a day when it is cleared', async () => {
    await planDay(store, OFFICE, date);
    await store.clearGroups(date, OFFICE);

    expect(await store.listGroups(date, OFFICE)).toEqual([]);
    expect(await store.listUnmatched(date, OFFICE)).toEqual([]);
  });

  it('counts the current day as history, which callers must exclude', async () => {
    await planDay(store, OFFICE, date);
    const history = await store.listPastMatches();

    expect(history.some((m) => m.date === date)).toBe(true);
    expect(history.filter((m) => m.date !== date).length).toBeGreaterThan(0);
  });
});

describe('SqliteStore persistence', () => {
  const path = join(directory, 'restart.db');

  afterEach(() => rmSync(path, { force: true }));

  it('still knows what it sent after the process restarts', async () => {
    const world = new DemoStore(7, 160).world();
    const date = upcomingWeekdays(1, todayInZone('Europe/Istanbul'))[0]!;
    const open = () =>
      new SqliteStore({
        path,
        employees: world.employees,
        offices: world.offices,
        attendance: world.attendance,
      });

    const before = open();
    for (const optIn of world.optIns) await before.setOptIn(optIn);
    await planDay(before, OFFICE, date);
    const groups = await before.listGroups(date, OFFICE);
    for (const group of groups) await before.markInviteSent(group.id);
    const tally = groups.length;
    before.close();

    // A new process, the same file. This is the case that mailed nine tables
    // twice when the answer lived in memory.
    const after = open();
    const reopened = await after.listGroups(date, OFFICE);

    expect(reopened).toHaveLength(tally);
    expect(reopened.every((g) => g.invitesSentAt !== null)).toBe(true);
    expect((await after.listOptIns(date, OFFICE)).length).toBe(
      world.optIns.filter((o) => o.date === date && o.officeId === OFFICE).length,
    );
    after.close();
  });
});

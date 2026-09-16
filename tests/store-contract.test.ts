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
  await pool.query(`DROP TABLE IF EXISTS group_members, groups, opt_ins, unmatched,
    past_matches, self_declared_attendance, suppressed_attendance, day_locks CASCADE`);
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

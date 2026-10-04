import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb, officeFixture, person, seedBasics, type TestDb } from './support/db';
import { RecordingChannel } from './support/channel';
import { runTick, planNow } from '../src/services/tick';
import { createOffice, addHoliday, getOffice } from '../src/data/offices';
import { setPattern, setRequest, getRequest } from '../src/data/lunch';
import { listTables, listUnseated, tableOf } from '../src/data/tables';
import { listRuns } from '../src/data/jobs';
import { dropLunch, respond, wantLunch } from '../src/services/days';
import type { Person } from '../src/data/types';

let t: TestDb;
const channel = new RecordingChannel();
const FROM = 'Sofra <sofra@acme.test>';

async function tick(iso: string) {
  return runTick({ db: t.db, channel, from: FROM, now: new Date(iso) });
}

/** One office's jobs of one kind from a tick: each tick runs every office's. */
async function jobs(iso: string, officeId: string, kind: 'match' | 'reminder' = 'match') {
  return (await tick(iso)).filter((a) => a.officeId === officeId && a.kind === kind);
}

async function ask(p: Person, date: string, officeId = 'IST', slot: string | null = null) {
  await setRequest(t.db, { employeeId: p.id, date, officeId, slot, source: 'manual' });
}

const people: Person[] = [];

beforeAll(async () => {
  t = await createTestDb();
  await seedBasics(t.db);
  // Amsterdam changes its clocks; Istanbul does not.
  await createOffice(
    t.db,
    officeFixture({
      id: 'AMS',
      name: 'Amsterdam',
      timeZone: 'Europe/Amsterdam',
      opensAt: '08:30',
      locationKeywords: ['amsterdam'],
    }),
  );
  for (let i = 0; i < 12; i++) people.push(await person(t.db, i));
});
afterAll(async () => t.cleanup());
beforeEach(() => channel.clear());

describe('making the tables, office by office, in each office’s own time', () => {
  // Monday 2026-10-05. Istanbul is UTC+3 all year: opens 09:00, three hours'
  // lead, so tables are made at 06:00 local, 03:00 UTC.
  const DAY = '2026-10-05';

  it('does nothing before the moment and everything at it, once', async () => {
    for (const p of people.slice(0, 8)) await ask(p, DAY);

    expect(await jobs('2026-10-05T02:59:00Z', 'IST')).toEqual([]);
    expect(await listTables(t.db, 'IST', DAY)).toEqual([]);

    const actions = await jobs('2026-10-05T03:00:00Z', 'IST');
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({
      officeId: 'IST',
      kind: 'match',
      date: DAY,
      status: 'done',
      summary: { requests: 8, tables: 2, seated: 8, unseated: 0, invitesSent: 2 },
    });
    expect(channel.invites).toHaveLength(2);

    // The next tick, a retry, a second scheduler: nothing more.
    expect(await jobs('2026-10-05T03:15:00Z', 'IST')).toEqual([]);
    expect(await jobs('2026-10-05T03:15:00Z', 'IST')).toEqual([]);
    expect(channel.invites).toHaveLength(2);
  });

  it('names the lunch as the instant it happens', async () => {
    const [table] = await listTables(t.db, 'IST', DAY);
    expect(table!.startsAt).toBe('2026-10-05T09:00:00.000Z');
    expect(table!.timeZone).toBe('Europe/Istanbul');
    expect(channel.invites).toEqual([]);
  });

  it('follows a clock change: Amsterdam at 05:30 local is 03:30 UTC in summer, 04:30 in winter', async () => {
    const summer = '2026-10-23'; // Friday, CEST
    const winter = '2026-10-26'; // Monday, CET
    for (const p of people.slice(0, 3)) {
      await ask(p, summer, 'AMS');
      await ask(p, winter, 'AMS');
    }

    expect(await jobs('2026-10-23T03:29:00Z', 'AMS')).toEqual([]);
    expect(await jobs('2026-10-23T03:30:00Z', 'AMS')).toMatchObject([
      { date: summer, status: 'done', summary: { seated: 3 } },
    ]);

    expect(await jobs('2026-10-26T04:29:00Z', 'AMS')).toEqual([]);
    expect(await jobs('2026-10-26T04:30:00Z', 'AMS')).toMatchObject([
      { date: winter, status: 'done', summary: { seated: 3 } },
    ]);
  });

  it('skips weekends and holidays', async () => {
    await addHoliday(t.db, { officeId: 'IST', date: '2026-10-29', name: 'Republic Day' });
    await ask(people[0]!, '2026-10-29');
    await ask(people[0]!, '2026-10-31'); // Saturday

    expect(await jobs('2026-10-29T03:00:00Z', 'IST')).toEqual([]);
    expect(await jobs('2026-10-31T03:00:00Z', 'IST')).toEqual([]);
  });

  it('says so, once, when the scheduler was down until after lunch', async () => {
    const day = '2026-10-07';
    await ask(people[0]!, day);
    expect(await jobs('2026-10-07T10:00:00Z', 'IST')).toMatchObject([
      { date: day, status: 'skipped' },
    ]);
    expect(await jobs('2026-10-07T10:15:00Z', 'IST')).toEqual([]);
  });

  it('still makes the tables when it wakes up late but before lunch', async () => {
    const day = '2026-10-08';
    for (const p of people.slice(0, 3)) await ask(p, day);
    expect(await jobs('2026-10-08T07:40:00Z', 'IST')).toMatchObject([
      { date: day, status: 'done', summary: { seated: 3 } },
    ]);
  });

  it('seats people who ask by weekly pattern, and writes their request down', async () => {
    const day = '2026-10-13'; // Tuesday
    for (const p of people.slice(0, 3)) {
      await setPattern(t.db, { employeeId: p.id, weekdays: [2], slot: null });
    }
    await tick('2026-10-13T03:00:00Z');
    expect((await listTables(t.db, 'IST', day)).flatMap((x) => x.members)).toHaveLength(3);
    expect(await getRequest(t.db, people[0]!.id, day)).toMatchObject({ source: 'weekly' });
    for (const p of people.slice(0, 3))
      await setPattern(t.db, { employeeId: p.id, weekdays: [], slot: null });
  });
});

describe('lunch times', () => {
  it('fills a short lunch time with people who said any time', async () => {
    const office = (await getOffice(t.db, 'IST'))!;
    const day = '2026-10-14';
    await t.db.query("UPDATE offices SET lunch_slots = ARRAY['12:00','13:00'] WHERE id = 'IST'");

    for (const p of people.slice(0, 4)) await ask(p, day, 'IST', '12:00');
    for (const p of people.slice(4, 6)) await ask(p, day, 'IST', '13:00');
    await ask(people[6]!, day, 'IST', null);

    await tick('2026-10-14T03:00:00Z');
    const tables = await listTables(t.db, 'IST', day);
    expect(tables.map((x) => [x.slot, x.members.length])).toEqual([
      ['12:00', 4],
      ['13:00', 3],
    ]);
    await t.db.query("UPDATE offices SET lunch_slots = ARRAY['12:00'] WHERE id = 'IST'");
    expect(office.lunchSlots).toEqual(['12:00']);
  });
});

describe('after the tables are made', () => {
  const DAY = '2026-10-15'; // Thursday
  const deps = (iso: string) => ({ db: t.db, channel, from: FROM, now: new Date(iso) });

  beforeAll(async () => {
    for (const p of people.slice(0, 6)) await ask(p, DAY);
    await tick('2026-10-15T03:00:00Z');
  });

  it('gives somebody late a free seat and sends the table its invite again', async () => {
    channel.clear();
    const late = people[6]!;
    const outcome = await wantLunch(deps('2026-10-15T05:00:00Z'), late, {
      date: DAY,
      officeId: 'IST',
      slot: null,
    });
    expect(outcome).toMatchObject({ ok: true });
    const table = await tableOf(t.db, late.id, DAY);
    expect(table?.members.map((m) => m.id)).toContain(late.id);
    expect(channel.invites).toHaveLength(1);
    expect(channel.invites[0]!.invite.ics).toContain('SEQUENCE:1');
  });

  it('closes the day at the reply cut-off', async () => {
    const outcome = await wantLunch(deps('2026-10-15T07:00:00Z'), people[7]!, {
      date: DAY,
      officeId: 'IST',
      slot: null,
    });
    expect(outcome).toEqual({ ok: false, reason: 'closed' });
  });

  it('reseats the others when a drop-out leaves a table too small', async () => {
    channel.clear();
    const tables = await listTables(t.db, 'IST', DAY);
    const small = tables.find((x) => x.members.length === 3)!;
    const [a] = small.members;
    const leaver = people.find((p) => p.id === a!.id)!;

    await respond(deps('2026-10-15T05:30:00Z'), leaver, small.id, 'declined');
    const after = await listTables(t.db, 'IST', DAY);
    const collapsed = after.find((x) => x.id === small.id)!;
    // Two left are not a lunch; one of them may have been moved, the table is off.
    expect(collapsed.cancelled).toBe(true);
    expect(channel.cancellations.length + channel.invites.length).toBeGreaterThan(0);
    expect(await getRequest(t.db, leaver.id, DAY)).toBeNull();
  });

  it('records a reply after the cut-off without moving anybody', async () => {
    const tables = (await listTables(t.db, 'IST', DAY)).filter((x) => !x.cancelled);
    const table = tables[0]!;
    const member = people.find((p) => p.id === table.members[0]!.id)!;
    const before = table.members.map((m) => m.id);

    await respond(deps('2026-10-15T08:00:00Z'), member, table.id, 'declined');
    const after = (await listTables(t.db, 'IST', DAY)).find((x) => x.id === table.id)!;
    expect(after.members.map((m) => m.id)).toEqual(before);
    expect(after.rsvps[member.id]).toBe('declined');
  });
});

describe('before the tables are made', () => {
  it('lets somebody change their mind freely, and move to another office', async () => {
    const day = '2026-10-16';
    const p = people[0]!;
    const deps = { db: t.db, channel, from: FROM, now: new Date('2026-10-15T12:00:00Z') };
    expect(await wantLunch(deps, p, { date: day, officeId: 'IST', slot: null })).toEqual({
      ok: true,
    });
    expect(await wantLunch(deps, p, { date: day, officeId: 'AMS', slot: null })).toEqual({
      ok: true,
    });
    expect(await getRequest(t.db, p.id, day)).toMatchObject({ officeId: 'AMS' });
    expect(await dropLunch(deps, p, day)).toEqual({ ok: true });
    expect(await getRequest(t.db, p.id, day)).toBeNull();
  });

  it('refuses a lunch time the office does not have', async () => {
    const deps = { db: t.db, channel, from: FROM, now: new Date('2026-10-15T12:00:00Z') };
    expect(
      await wantLunch(deps, people[0]!, { date: '2026-10-16', officeId: 'IST', slot: '15:00' }),
    ).toEqual({ ok: false, reason: 'invalid-slot' });
  });
});

describe('people who cannot be seated', () => {
  it('are told once why, and it is recorded', async () => {
    const day = '2026-10-19';
    await ask(people[0]!, day);
    await ask(people[1]!, day);
    await tick('2026-10-19T03:00:00Z');
    expect(channel.reminders.map((r) => r.employee.id).sort()).toEqual(
      [people[0]!.id, people[1]!.id].sort(),
    );
    expect(await listUnseated(t.db, 'IST', day)).toHaveLength(2);
  });
});

describe('the evening before', () => {
  it('asks on Friday about Monday, only people likely to want it, once', async () => {
    // people[3] ate recently; a newcomer never has; people[1] already asked.
    const newcomer = await person(t.db, 500);
    const monday = '2026-10-26';
    await ask(people[1]!, monday);

    const reminders = await jobs('2026-10-23T13:00:00Z', 'IST', 'reminder'); // Friday 16:00
    expect(reminders).toMatchObject([{ date: monday, status: 'done' }]);
    const asked = channel.reminders.map((r) => r.employee.id);
    expect(asked).toContain(people[3]!.id);
    expect(asked).not.toContain(people[1]!.id);
    expect(asked).not.toContain(newcomer.id);
    expect(channel.reminders[0]!.text).toContain('06:00');

    channel.clear();
    expect(await jobs('2026-10-23T13:15:00Z', 'IST', 'reminder')).toEqual([]);
    expect(channel.reminders).toEqual([]);
  });
});

describe('the console', () => {
  it('re-plans a day on request and cancels the tables people were already sent', async () => {
    const office = (await getOffice(t.db, 'IST'))!;
    const day = '2026-10-05';
    channel.clear();
    const action = await planNow(
      { db: t.db, channel, from: FROM, now: new Date('2026-10-05T04:00:00Z') },
      office,
      day,
    );
    expect(action).toMatchObject({ status: 'done', summary: { previousCancelled: 2 } });
    expect(channel.cancellations).toHaveLength(2);
    expect(channel.invites).toHaveLength(2);

    const runs = await listRuns(t.db, { officeId: 'IST' });
    expect(runs.some((r) => r.trigger === 'manual' && r.runKey === day)).toBe(true);
  });

  describe('tables made by hand the day before', () => {
    // Wednesday 2026-10-21: an admin presses the button on Tuesday afternoon,
    // long before the 06:00 run.
    const DAY = '2026-10-21';
    const tuesday = (hhmm: string) => new Date(`2026-10-20T${hhmm}:00Z`);
    const deps = (now: Date) => ({ db: t.db, channel, from: FROM, now });

    beforeAll(async () => {
      for (const p of people.slice(0, 7)) await ask(p, DAY);
      channel.clear();
      const office = (await getOffice(t.db, 'IST'))!;
      await planNow(deps(tuesday('12:00')), office, DAY);
    });

    it('count as the day’s tables: somebody asking later takes a free seat', async () => {
      expect(await listTables(t.db, 'IST', DAY)).toHaveLength(2);
      const late = people[7]!;
      const outcome = await wantLunch(deps(tuesday('13:00')), late, {
        date: DAY,
        officeId: 'IST',
        slot: null,
      });
      expect(outcome).toMatchObject({ ok: true });
      expect((await tableOf(t.db, late.id, DAY))?.members.map((m) => m.id)).toContain(late.id);
      expect(channel.invites).toHaveLength(1);
    });

    it('are not made again on schedule, and nobody gets a second lunch', async () => {
      const seated = await tableOf(t.db, people[0]!.id, DAY);
      await respond(deps(tuesday('14:00')), people[0]!, seated!.id, 'accepted');
      channel.clear();

      const actions = await jobs('2026-10-21T03:00:00Z', 'IST');
      expect(actions).toEqual([{ officeId: 'IST', kind: 'match', date: DAY, status: 'skipped' }]);
      expect(channel.invites).toHaveLength(0);
      expect(channel.cancellations).toHaveLength(0);

      // The tables and the replies on them are the ones people were sent.
      const after = await tableOf(t.db, people[0]!.id, DAY);
      expect(after?.id).toBe(seated!.id);
      expect(after?.rsvps[people[0]!.id]).toBe('accepted');

      const run = (await listRuns(t.db, { officeId: 'IST' })).find(
        (r) => r.runKey === DAY && r.trigger === 'schedule',
      );
      expect(run).toMatchObject({
        status: 'skipped',
        summary: { reason: 'the tables were already made by hand' },
      });
    });
  });
});

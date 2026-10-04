import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestDb, person, seedBasics, type TestDb } from './support/db';
import { RecordingChannel } from './support/channel';
import { DEMO_SETTING } from '../src/auth/demo';
import { roleOf } from '../src/auth/roles';
import { openSession } from '../src/auth/signin';
import { addGrant } from '../src/data/admin';
import { getOffice } from '../src/data/offices';
import { setRequest } from '../src/data/lunch';
import { getPersonByEmail } from '../src/data/people';
import { setSetting } from '../src/data/settings';
import { listTables, tableOf } from '../src/data/tables';
import { listRuns } from '../src/data/jobs';
import type { Person } from '../src/data/types';
import { enterDemo } from '../src/services/demo';
import { runTick } from '../src/services/tick';

/**
 * The public demo's door: when it opens, what a visitor walks into, and what
 * they may not touch.
 */
let t: TestDb;
const channel = new RecordingChannel();
const FROM = 'Sofra <sofra@acme.test>';
const deps = (iso: string) => ({ db: t.db, channel, from: FROM, now: new Date(iso) });
const people: Person[] = [];
let visitor = 0;
const enter = (iso: string, ip = `203.0.113.${++visitor}`) => enterDemo(deps(iso), { ip });

// Sunday evening in Istanbul: Monday 2026-10-05 is still collecting requests.
const SUNDAY = '2026-10-04T15:00:00Z';
const MONDAY = '2026-10-05';

beforeAll(async () => {
  t = await createTestDb();
  await seedBasics(t.db);
  for (let i = 0; i < 9; i++) people.push(await person(t.db, i));
});
afterAll(async () => t.cleanup());
beforeEach(() => {
  channel.clear();
  vi.unstubAllEnvs();
});

describe('the demo door', () => {
  it('stays shut unless the deployment says it is a demo', async () => {
    await setSetting(t.db, DEMO_SETTING, true);
    expect(await enter(SUNDAY)).toEqual({ ok: false, reason: 'closed' });
    await setSetting(t.db, DEMO_SETTING, false);
  });

  it('stays shut on a database the seed did not fill, whatever the deployment says', async () => {
    vi.stubEnv('SOFRA_DEMO', 'true');
    expect(await enter(SUNDAY)).toEqual({ ok: false, reason: 'closed' });
    // And nobody becomes a viewer of a real company's console that way.
    expect(await roleOf(t.db, people[0]!)).toBeNull();
  });
});

describe('walking into the demo', () => {
  beforeAll(async () => {
    await setSetting(t.db, DEMO_SETTING, true);
    for (const p of people.slice(0, 6)) {
      await setRequest(t.db, {
        employeeId: p.id,
        date: MONDAY,
        officeId: 'IST',
        slot: null,
        source: 'manual',
      });
    }
  });
  beforeEach(() => vi.stubEnv('SOFRA_DEMO', 'true'));

  it('gives the visitor a colleague of their own, already at a table', async () => {
    const entry = await enter(SUNDAY);
    expect(entry).toMatchObject({ ok: true, seatedOn: MONDAY });
    if (!entry.ok) return;

    expect(entry.guest).toMatchObject({ officeId: 'IST', active: true, title: 'Visitor' });
    expect(entry.guest.onboardedAt).not.toBeNull();
    expect(entry.guest.email).toMatch(/^guest-.+@sofra\.test$/);

    const table = await tableOf(t.db, entry.guest.id, MONDAY);
    expect(table?.members.map((m) => m.id)).toContain(entry.guest.id);
    expect(table!.members.length).toBeGreaterThanOrEqual(3);
  });

  it('seats the next visitors too, each as somebody else, guests together if need be', async () => {
    const guests: Person[] = [];
    for (let i = 0; i < 5; i++) {
      const entry = await enter(SUNDAY);
      expect(entry.ok).toBe(true);
      if (entry.ok) {
        expect(entry.seatedOn).toBe(MONDAY);
        guests.push(entry.guest);
      }
    }
    expect(new Set(guests.map((g) => g.id)).size).toBe(5);
    for (const g of guests) {
      const table = await tableOf(t.db, g.id, MONDAY);
      expect(table && !table.cancelled, g.displayName).toBe(true);
    }
    // Nobody was dropped to make room: everybody who asked still has a seat.
    const seated = (await listTables(t.db, 'IST', MONDAY))
      .filter((x) => !x.cancelled)
      .flatMap((x) => x.members.map((m) => m.id));
    for (const p of people.slice(0, 6)) expect(seated).toContain(p.id);
  });

  it('leaves the day alone when the scheduler reaches it', async () => {
    const before = (await listTables(t.db, 'IST', MONDAY)).map((x) => x.id).sort();
    channel.clear();
    const actions = await runTick(deps('2026-10-05T03:00:00Z'));
    expect(actions.filter((a) => a.officeId === 'IST' && a.kind === 'match')).toEqual([
      { officeId: 'IST', kind: 'match', date: MONDAY, status: 'skipped' },
    ]);
    expect((await listTables(t.db, 'IST', MONDAY)).map((x) => x.id).sort()).toEqual(before);
    expect(channel.invites).toHaveLength(0);
  });

  it('lets a visitor look at the console and change nothing in it', async () => {
    const entry = await enter(SUNDAY);
    if (!entry.ok) throw new Error('the door should be open');
    expect(await roleOf(t.db, entry.guest)).toEqual({
      everyOffice: true,
      officeIds: [],
      bootstrap: false,
      readOnly: true,
    });

    // Somebody who really is an admin still is one.
    await addGrant(t.db, { employeeId: people[8]!.id, officeId: null, grantedBy: 'test' });
    expect((await roleOf(t.db, people[8]!))?.readOnly).toBe(false);
  });

  it('keeps no address for a visitor, and can open a session for them', async () => {
    const entry = await enter(SUNDAY, '198.51.100.77');
    if (!entry.ok) throw new Error('the door should be open');
    const session = await openSession(t.db, entry.guest, 'demo', { ip: '', userAgent: 'vitest' });
    expect(session.person.id).toBe(entry.guest.id);

    const { rows } = await t.db.query<{ key: string }>('SELECT key FROM rate_limit_events');
    expect(rows.some((r) => r.key.includes('198.51.100.77'))).toBe(false);
    expect((await getPersonByEmail(t.db, entry.guest.email))?.source).toBe('self');
  });

  it('stops one visitor from making guests without end', async () => {
    const outcomes = [];
    for (let i = 0; i < 7; i++) outcomes.push((await enter(SUNDAY, '192.0.2.9')).ok);
    expect(outcomes).toEqual([true, true, true, true, true, true, false]);
    expect(await enter(SUNDAY, '192.0.2.9')).toEqual({ ok: false, reason: 'busy' });
  });

  it('records what it did, as a run made by hand', async () => {
    const office = (await getOffice(t.db, 'IST'))!;
    const runs = await listRuns(t.db, { officeId: office.id });
    expect(runs.some((r) => r.kind === 'match' && r.trigger === 'manual')).toBe(true);
  });
});

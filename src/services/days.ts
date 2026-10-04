import { applyRsvp, seatLatecomer, type SeatedTable } from '../core/reseating';
import type { Db } from '../db';
import { cancelRequest, getRequest, setRequest } from '../data/lunch';
import { getOffice, listHolidays } from '../data/offices';
import { isMatchable, toEmployee } from '../data/people';
import {
  addUnseated,
  getTable,
  isPlanned,
  listTables,
  lockDay,
  pastMatches,
  removeUnseated,
  saveTables,
  tableOf,
  type LunchTable,
} from '../data/tables';
import type { Office, Person, RsvpStatus } from '../data/types';
import type { InviteChannel } from '../notify/channels';
import { deliverPending } from './delivery';
import { officeConfig } from './planning';
import { dayPhase, type DayPhase } from './schedule';

export interface DayDeps {
  db: Db;
  channel: InviteChannel;
  from: string;
  now: Date;
}

export type DayOutcome =
  | { ok: true; seated?: LunchTable | null }
  | {
      ok: false;
      reason:
        | 'closed'
        | 'off'
        | 'unknown-office'
        | 'invalid-slot'
        | 'not-ready'
        | 'no-seat'
        | 'not-seated';
    };

export async function phaseOf(db: Db, office: Office, date: string, now: Date): Promise<DayPhase> {
  const holidays = new Set(
    (await listHolidays(db, office.id, { from: date, to: date })).map((h) => h.date),
  );
  return dayPhase(office, date, holidays, now, await isPlanned(db, office.id, date));
}

/**
 * "I will be at this office that day and I want lunch."
 *
 * Before the tables are made this is simply recorded. After, while replies are
 * still open, it takes a free seat if there is one that keeps every rule, and
 * the table gets its invite again with the newcomer on it. After the cut-off
 * the day is closed.
 */
export async function wantLunch(
  deps: DayDeps,
  person: Person,
  choice: { date: string; officeId: string; slot: string | null; source?: 'manual' | 'teams' },
): Promise<DayOutcome> {
  const { db } = deps;
  if (!isMatchable(person)) return { ok: false, reason: 'not-ready' };

  const office = await getOffice(db, choice.officeId);
  if (!office || !office.active) return { ok: false, reason: 'unknown-office' };
  if (choice.slot !== null && !office.lunchSlots.includes(choice.slot)) {
    return { ok: false, reason: 'invalid-slot' };
  }

  const phase = await phaseOf(db, office, choice.date, deps.now);
  if (phase === 'off') return { ok: false, reason: 'off' };
  if (phase === 'closed' || phase === 'past') return { ok: false, reason: 'closed' };

  // Moving to another office that day takes you off the first one's table.
  const current = await tableOf(db, person.id, choice.date);
  if (current && current.officeId !== office.id && !current.cancelled) {
    await respond(deps, person, current.id, 'declined');
  }

  await setRequest(db, {
    employeeId: person.id,
    date: choice.date,
    officeId: office.id,
    slot: choice.slot,
    source: choice.source ?? 'manual',
  });

  if (phase === 'open') return { ok: true };

  // Tables exist. A person who declined and changed their mind is still on
  // theirs; anybody else needs a seat.
  const own = await tableOf(db, person.id, choice.date);
  if (own && own.officeId === office.id && !own.cancelled) {
    if (own.rsvps[person.id] === 'declined') await respond(deps, person, own.id, 'accepted');
    return { ok: true, seated: await getTable(db, own.id) };
  }

  const seated = await db.transaction(async (tx) => {
    await lockDay(tx, office.id, choice.date);
    const tables = (await listTables(tx, office.id, choice.date)).filter(
      (t) => choice.slot === null || t.slot === choice.slot,
    );
    const host = seatLatecomer({
      tables,
      person: toEmployee(person, office.id),
      pastMatches: await pastMatches(tx, choice.date),
      config: officeConfig(office),
    }) as LunchTable | null;

    if (!host) {
      await addUnseated(tx, {
        officeId: office.id,
        date: choice.date,
        employeeId: person.id,
        reason: 'pool-too-small',
      });
      return null;
    }
    await saveTables(tx, [host]);
    await removeUnseated(tx, person.id, choice.date);
    return host;
  });

  if (!seated) return { ok: false, reason: 'no-seat' };
  await deliverPending(db, deps.channel, office, choice.date, deps.from);
  return { ok: true, seated };
}

/**
 * "Not that day after all." Before the tables are made it just withdraws the
 * request; after, it is the same as telling the table you cannot come, which
 * reseats the others if the table gets too small.
 */
export async function dropLunch(deps: DayDeps, person: Person, date: string): Promise<DayOutcome> {
  const { db } = deps;
  const table = await tableOf(db, person.id, date);
  const request = await getRequest(db, person.id, date);
  const officeId = table?.officeId ?? request?.officeId ?? person.officeId;
  const office = officeId ? await getOffice(db, officeId) : null;
  if (!office) return { ok: false, reason: 'unknown-office' };

  const phase = await phaseOf(db, office, date, deps.now);
  if (phase === 'past') return { ok: false, reason: 'closed' };

  await cancelRequest(db, person.id, date);
  await removeUnseated(db, person.id, date);
  if (table && !table.cancelled && table.rsvps[person.id] !== 'declined') {
    await respond(deps, person, table.id, 'declined');
  }
  return { ok: true };
}

/**
 * A reply from somebody at a table. While replies are open a drop-out can
 * collapse the table and move the others; after the cut-off the reply is
 * recorded so the table knows, and nobody is moved.
 */
export async function respond(
  deps: DayDeps,
  person: Person,
  tableId: string,
  status: RsvpStatus,
): Promise<DayOutcome> {
  const { db } = deps;
  const table = await getTable(db, tableId);
  if (!table || !(person.id in table.rsvps)) return { ok: false, reason: 'not-seated' };

  const office = await getOffice(db, table.officeId);
  if (!office) return { ok: false, reason: 'unknown-office' };
  const phase = await phaseOf(db, office, table.date, deps.now);
  if (phase === 'past') return { ok: false, reason: 'closed' };

  await db.transaction(async (tx) => {
    await lockDay(tx, office.id, table.date);
    const tables = await listTables(tx, office.id, table.date);

    let changed: SeatedTable[];
    if (phase === 'closed') {
      const own = tables.find((t) => t.id === tableId);
      if (!own) return;
      own.rsvps[person.id] = status;
      changed = [own];
    } else {
      changed = applyRsvp({
        tables,
        groupId: tableId,
        employeeId: person.id,
        status,
        pastMatches: await pastMatches(tx, table.date),
        config: officeConfig(office),
      });
    }
    await saveTables(tx, changed as LunchTable[]);
  });

  if (status === 'declined') await cancelRequest(db, person.id, table.date);
  if (status === 'accepted') {
    await setRequest(db, {
      employeeId: person.id,
      date: table.date,
      officeId: office.id,
      slot: table.slot,
      source: 'manual',
    });
  }

  await deliverPending(db, deps.channel, office, table.date, deps.from);
  return { ok: true, seated: await getTable(db, tableId) };
}

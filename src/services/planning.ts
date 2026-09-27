import { randomBytes } from 'node:crypto';
import { matchLunches } from '../core/matcher';
import { DEFAULT_CONFIG, type MatchConfig, type UnmatchedReason } from '../core/types';
import type { Db } from '../db';
import { materialiseWeekly, requestsForDay } from '../data/lunch';
import { getPeople, isMatchable, toEmployee } from '../data/people';
import { lockDay, pastMatches, replaceDay, type DayPlan } from '../data/tables';
import type { LunchRequest, Office } from '../data/types';
import { lunchInstant } from './schedule';

/** The matcher's settings for one office: its own table sizes. */
export function officeConfig(office: Office): MatchConfig {
  const preferred = Math.min(office.maxTable, Math.max(office.minTable, 4));
  return {
    ...DEFAULT_CONFIG,
    minGroupSize: office.minTable,
    maxGroupSize: office.maxTable,
    groupSize: preferred,
  };
}

/**
 * Who eats at which lunch time.
 *
 * People who picked a time get it. People who said any time fill the times
 * that are short of a table first, because a time with two people is two
 * people told there is no lunch, and otherwise go where most people already
 * are, because a bigger pool makes better tables. A time that no longer exists
 * at the office counts as "any".
 */
export function assignSlots(
  requests: readonly Pick<LunchRequest, 'employeeId' | 'slot'>[],
  slots: readonly string[],
  minTable: number,
): Map<string, string[]> {
  const pools = new Map<string, string[]>(slots.map((s) => [s, []]));
  const flexible: string[] = [];

  for (const request of requests) {
    const pool = request.slot ? pools.get(request.slot) : undefined;
    if (pool) pool.push(request.employeeId);
    else flexible.push(request.employeeId);
  }

  for (const employeeId of [...flexible].sort()) {
    const short = [...pools.entries()]
      .filter(([, members]) => members.length > 0 && members.length < minTable)
      .sort((a, b) => b[1].length - a[1].length || slots.indexOf(a[0]) - slots.indexOf(b[0]));
    const target =
      short[0] ??
      [...pools.entries()].sort(
        (a, b) => b[1].length - a[1].length || slots.indexOf(a[0]) - slots.indexOf(b[0]),
      )[0];
    target?.[1].push(employeeId);
  }
  return pools;
}

export interface PlanSummary {
  officeId: string;
  date: string;
  requests: number;
  tables: number;
  seated: number;
  unseated: number;
  bySlot: Record<string, { tables: number; seated: number; unseated: number }>;
  relaxed: number;
}

/**
 * Plans one day at one office: everybody who asked, at every lunch time, in
 * one go. Replaces whatever plan the day had, inside one transaction, so the
 * day is never half old and half new.
 */
export async function planOfficeDay(db: Db, office: Office, date: string): Promise<PlanSummary> {
  const requests = await requestsForDay(db, office.id, date);
  const people = new Map(
    (
      await getPeople(
        db,
        requests.map((r) => r.employeeId),
      )
    )
      .filter(isMatchable)
      .map((p) => [p.id, p]),
  );
  const wanted = requests.filter((r) => people.has(r.employeeId));
  const history = await pastMatches(db, date);
  const config = officeConfig(office);
  const pools = assignSlots(wanted, office.lunchSlots, office.minTable);

  const plan: DayPlan = {
    officeId: office.id,
    date,
    timeZone: office.timeZone,
    tables: [],
    unseated: [],
  };
  const summary: PlanSummary = {
    officeId: office.id,
    date,
    requests: wanted.length,
    tables: 0,
    seated: 0,
    unseated: 0,
    bySlot: {},
    relaxed: 0,
  };

  for (const slot of office.lunchSlots) {
    const ids = pools.get(slot) ?? [];
    if (ids.length === 0) continue;

    const result = matchLunches({
      date,
      officeId: office.id,
      slot,
      employees: ids.map((id) => toEmployee(people.get(id)!, office.id)),
      optIns: ids.map((employeeId) => ({ employeeId, date, officeId: office.id, slot })),
      pastMatches: history,
      config,
    });

    const startsAt = lunchInstant(office, date, slot);
    result.groups.forEach((group, index) => {
      plan.tables.push({ ...group, id: tableId(office.id, date, slot, index), startsAt });
    });
    for (const entry of result.unmatched) {
      plan.unseated.push({
        employeeId: entry.employee.id,
        reason: entry.reason as UnmatchedReason,
      });
    }

    const seated = result.groups.reduce((n, g) => n + g.members.length, 0);
    summary.bySlot[slot] = {
      tables: result.groups.length,
      seated,
      unseated: result.unmatched.length,
    };
    summary.tables += result.groups.length;
    summary.seated += seated;
    summary.unseated += result.unmatched.length;
    summary.relaxed += result.groups.filter((g) => g.relaxation !== 'none').length;
  }

  await db.transaction(async (tx) => {
    await lockDay(tx, office.id, date);
    await replaceDay(tx, plan);
    await materialiseWeekly(tx, wanted);
  });
  return summary;
}

/**
 * Unguessable, and different every time a day is planned: an invite link from
 * a plan that has since been replaced must not open whatever table happens to
 * reuse its number.
 */
function tableId(officeId: string, date: string, slot: string, index: number): string {
  return `${officeId}-${date}-${slot.replace(':', '')}-${index + 1}-${randomBytes(5).toString('hex')}`;
}

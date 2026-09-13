import { matchLunches } from '../core/matcher';
import type { InviteChannel } from '../notify/channels';
import { deliverPending } from './notifications';
import type { Store } from '../store/types';
import type { MatchResult } from '../core/types';
import { SLOT } from '../store/demo';
import { todayInZone, upcomingWeekdays } from './dates';

export interface NightlyOptions {
  store: Store;
  channel: InviteChannel;
  from: string;
  /** Override the day being planned. Defaults to each office's next weekday. */
  date?: string;
}

export interface OfficeOutcome {
  officeId: string;
  date: string;
  optedIn: number;
  tables: number;
  seated: number;
  unseated: number;
  invitesSent: number;
}

/**
 * Plans one day at one office: everyone who asked for a lunch *and* is actually
 * in the building goes into the pool, and the result replaces whatever plan that
 * day had before.
 *
 * The admin console's button and the nightly job both call this, so there is one
 * definition of how a day gets planned rather than two that can drift.
 */
export async function planDay(store: Store, officeId: string, date: string): Promise<MatchResult> {
  const attending = new Set(await store.getAttendance(date, officeId));
  const optIns = store.listOptIns(date, officeId).filter((o) => attending.has(o.employeeId));

  const result = matchLunches({
    date,
    officeId,
    slot: SLOT,
    employees: store.listEmployees(),
    optIns,
    // Never let the day being planned count as a past lunch: re-running would
    // otherwise treat the plan it is replacing as people who already met.
    pastMatches: store.listPastMatches().filter((m) => m.date !== date),
  });

  store.saveMatchResult(result);
  return result;
}

/**
 * What the cron job does the evening before: for every office, match everyone
 * who asked for a lunch and is actually in the building, then send one invite
 * per table.
 *
 * Pure with respect to time — pass a `date` to plan a specific day — so it can
 * be tested without waiting for tomorrow.
 */
export async function runNightlyMatching(options: NightlyOptions): Promise<OfficeOutcome[]> {
  const { store, channel, from } = options;
  const outcomes: OfficeOutcome[] = [];

  for (const office of store.listOffices()) {
    // Each office plans its own next working day, in its own timezone.
    const date = options.date ?? upcomingWeekdays(1, todayInZone(office.timeZone))[0]!;

    const result = await planDay(store, office.id, date);

    const delivered = await deliverPending({
      store,
      channel,
      from,
      date,
      officeId: office.id,
    });

    outcomes.push({
      officeId: office.id,
      date,
      optedIn:
        result.groups.reduce((sum, g) => sum + g.members.length, 0) + result.unmatched.length,
      tables: result.groups.length,
      seated: result.groups.reduce((sum, g) => sum + g.members.length, 0),
      unseated: result.unmatched.length,
      invitesSent: delivered.invitesSent,
    });
  }

  return outcomes;
}

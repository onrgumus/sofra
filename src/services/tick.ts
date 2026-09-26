import type { Db } from '../db';
import {
  claimScheduled,
  finishRun,
  recordSkipped,
  scheduledRunExists,
  startManual,
} from '../data/jobs';
import { listHolidays, listOffices } from '../data/offices';
import { pruneExpiredSessions } from '../data/sessions';
import { listTables } from '../data/tables';
import type { Office } from '../data/types';
import { addDays } from '../lib/zoned';
import type { InviteChannel } from '../notify/channels';
import { deliverPending, describe, inviteFor } from './delivery';
import { planOfficeDay } from './planning';
import { sendEveningReminders } from './reminders';
import {
  firstLunchInstant,
  isWorkingDay,
  matchInstant,
  officeToday,
  reminderInstant,
  workingDaysFrom,
  type Holidays,
} from './schedule';

export interface TickDeps {
  db: Db;
  channel: InviteChannel;
  from: string;
  now: Date;
  /** Refreshes Outlook office days before the evening question, when configured. */
  refreshHints?: (office: Office, date: string) => Promise<void>;
  /** Re-reads the company directory, when one is configured. */
  syncDirectory?: () => Promise<Record<string, unknown>>;
}

export interface TickAction {
  officeId: string | null;
  kind: 'match' | 'reminder' | 'directory-sync';
  date: string;
  status: 'done' | 'failed' | 'skipped';
  summary?: Record<string, unknown>;
  error?: string;
}

/** A reminder that could not go out in its hour is not sent at 3am instead. */
const REMINDER_WINDOW_MS = 3 * 3_600_000;
const DAY_MS = 86_400_000;

/**
 * What the scheduler calls every fifteen minutes.
 *
 * It holds no schedule of its own. For each office it works out, in that
 * office's zone, whether the moment for making a day's tables or for asking
 * about tomorrow has come, and does whatever is due and not yet done. So a new
 * office needs nothing added to any scheduler, a clock change moves nothing
 * that should stay put, and a tick that runs twice, or late, or on two
 * instances at once, does each job exactly once.
 */
export async function runTick(deps: TickDeps): Promise<TickAction[]> {
  const { db, now } = deps;
  const actions: TickAction[] = [];

  for (const office of await listOffices(db, { activeOnly: true })) {
    try {
      actions.push(...(await tickOffice(deps, office)));
    } catch (error) {
      // One office's bad day must not cost the others theirs.
      actions.push({
        officeId: office.id,
        kind: 'match',
        date: officeToday(office, now),
        status: 'failed',
        error: describe(error),
      });
    }
  }

  if (deps.syncDirectory) {
    const bucket = `${now.toISOString().slice(0, 10)}T${String(Math.floor(now.getUTCHours() / 6) * 6).padStart(2, '0')}`;
    const job = { kind: 'directory-sync' as const, officeId: null, runKey: bucket };
    const id = await claimScheduled(db, job);
    if (id !== null) {
      try {
        const summary = await deps.syncDirectory();
        await finishRun(db, id, { status: 'done', summary });
        actions.push({
          officeId: null,
          kind: 'directory-sync',
          date: bucket,
          status: 'done',
          summary,
        });
      } catch (error) {
        await finishRun(db, id, { status: 'failed', error: describe(error) });
        actions.push({
          officeId: null,
          kind: 'directory-sync',
          date: bucket,
          status: 'failed',
          error: describe(error),
        });
      }
    }
  }

  await pruneExpiredSessions(db);
  return actions;
}

async function tickOffice(deps: TickDeps, office: Office): Promise<TickAction[]> {
  const { db, now } = deps;
  const today = officeToday(office, now);
  const holidays: Holidays = new Set(
    (await listHolidays(db, office.id, { from: addDays(today, -1), to: addDays(today, 40) })).map(
      (h) => h.date,
    ),
  );
  const actions: TickAction[] = [];
  const t = now.getTime();

  // Tables. Tomorrow too, because an office that opens at 05:00 with a
  // six-hour lead makes its tables the evening before.
  for (const date of [today, addDays(today, 1)]) {
    if (!isWorkingDay(office, date, holidays)) continue;
    const due = matchInstant(office, date).getTime();
    if (t < due) continue;

    const job = { kind: 'match' as const, officeId: office.id, runKey: date };
    if (t >= firstLunchInstant(office, date).getTime()) {
      // Too late to be of use: lunch has started. Say so once, and only for a
      // lunch that was recently due, not for every day since the office began.
      if (t - due < DAY_MS && !(await scheduledRunExists(db, job))) {
        await recordSkipped(db, { ...job, reason: 'lunch had started before matching could run' });
        actions.push({ officeId: office.id, kind: 'match', date, status: 'skipped' });
      }
      continue;
    }

    const id = await claimScheduled(db, job);
    if (id === null) continue;
    actions.push(await runMatch(deps, office, date, id));
  }

  // The evening-before question, for each coming working day whose moment has come.
  for (const date of workingDaysFrom(office, today, 10, holidays)) {
    const due = reminderInstant(office, date, holidays).getTime();
    if (t < due) continue;
    if (t >= matchInstant(office, date).getTime()) continue;

    const job = { kind: 'reminder' as const, officeId: office.id, runKey: date };
    if (t - due > REMINDER_WINDOW_MS) {
      if (t - due < DAY_MS && !(await scheduledRunExists(db, job))) {
        await recordSkipped(db, { ...job, reason: 'the reminder hour had passed' });
        actions.push({ officeId: office.id, kind: 'reminder', date, status: 'skipped' });
      }
      continue;
    }

    const id = await claimScheduled(db, job);
    if (id === null) continue;
    try {
      if (deps.refreshHints) await deps.refreshHints(office, date).catch(() => undefined);
      const outcome = await sendEveningReminders(db, deps.channel, office, date);
      const summary = { ...outcome, failed: outcome.failed.length };
      await finishRun(db, id, { status: 'done', summary });
      actions.push({ officeId: office.id, kind: 'reminder', date, status: 'done', summary });
    } catch (error) {
      await finishRun(db, id, { status: 'failed', error: describe(error) });
      actions.push({
        officeId: office.id,
        kind: 'reminder',
        date,
        status: 'failed',
        error: describe(error),
      });
    }
  }

  return actions;
}

async function runMatch(
  deps: TickDeps,
  office: Office,
  date: string,
  jobId: number,
): Promise<TickAction> {
  try {
    const plan = await planOfficeDay(deps.db, office, date);
    const delivery = await deliverPending(deps.db, deps.channel, office, date, deps.from);
    const summary = {
      ...plan,
      invitesSent: delivery.invitesSent,
      unseatedTold: delivery.unseatedTold,
      failedToDeliver: delivery.failed.length,
    };
    // A plan that could not reach everybody is recorded as done, with the
    // failures counted, rather than retried: retrying would re-plan tables
    // people have already been told about.
    await finishRun(deps.db, jobId, { status: 'done', summary });
    return { officeId: office.id, kind: 'match', date, status: 'done', summary };
  } catch (error) {
    await finishRun(deps.db, jobId, { status: 'failed', error: describe(error) });
    return { officeId: office.id, kind: 'match', date, status: 'failed', error: describe(error) };
  }
}

/**
 * The console's button: plan a day now, whatever the clock says.
 *
 * Replacing a plan people have already been sent is a real event for them, so
 * every table whose invite went out is cancelled first, then the new tables are
 * sent. Without that, a re-plan leaves the old lunch in four calendars.
 */
export async function planNow(
  deps: Omit<TickDeps, 'refreshHints' | 'syncDirectory'>,
  office: Office,
  date: string,
): Promise<TickAction> {
  const { db } = deps;
  const id = await startManual(db, { kind: 'match', officeId: office.id, runKey: date });

  try {
    const previous = (await listTables(db, office.id, date)).filter(
      (t) => t.invitesSentAt !== null && !t.cancelled && t.members.length > 0,
    );
    const plan = await planOfficeDay(db, office, date);

    let cancelled = 0;
    for (const table of previous) {
      try {
        await deps.channel.sendCancellation({
          groupId: table.id,
          members: table.members,
          invite: inviteFor(
            { ...table, sequence: table.sequence + 1 },
            office,
            deps.from,
            'CANCEL',
          ),
        });
        cancelled++;
      } catch {
        // The new invite still goes out; a stale calendar entry is the lesser harm.
      }
    }

    const delivery = await deliverPending(db, deps.channel, office, date, deps.from);
    const summary = {
      ...plan,
      previousCancelled: cancelled,
      invitesSent: delivery.invitesSent,
      unseatedTold: delivery.unseatedTold,
      failedToDeliver: delivery.failed.length,
    };
    await finishRun(db, id, { status: 'done', summary });
    return { officeId: office.id, kind: 'match', date, status: 'done', summary };
  } catch (error) {
    await finishRun(db, id, { status: 'failed', error: describe(error) });
    return { officeId: office.id, kind: 'match', date, status: 'failed', error: describe(error) };
  }
}

/** The console's other button: ask about a day now. */
export async function remindNow(
  deps: Omit<TickDeps, 'syncDirectory'>,
  office: Office,
  date: string,
): Promise<TickAction> {
  const { db } = deps;
  const id = await startManual(db, { kind: 'reminder', officeId: office.id, runKey: date });
  try {
    if (deps.refreshHints) await deps.refreshHints(office, date).catch(() => undefined);
    const outcome = await sendEveningReminders(db, deps.channel, office, date);
    const summary = { ...outcome, failed: outcome.failed.length };
    await finishRun(db, id, { status: 'done', summary });
    return { officeId: office.id, kind: 'reminder', date, status: 'done', summary };
  } catch (error) {
    await finishRun(db, id, { status: 'failed', error: describe(error) });
    return {
      officeId: office.id,
      kind: 'reminder',
      date,
      status: 'failed',
      error: describe(error),
    };
  }
}

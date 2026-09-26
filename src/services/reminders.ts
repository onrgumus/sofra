import type { Db } from '../db';
import { recentDiners } from '../data/lunch';
import { hintedFor, listNotified, recordNotified } from '../data/messages';
import { listMatchablePeople, toEmployee } from '../data/people';
import type { Office } from '../data/types';
import { BASE_URL } from '../lib/config';
import { formatDay } from '../lib/dates';
import { addDays, formatLocalTime } from '../lib/zoned';
import type { InviteChannel } from '../notify/channels';
import { buildReminder } from '../notify/reminder';
import { describe, venueOf } from './delivery';
import { matchInstant } from './schedule';

export const REMINDER_KIND = 'reminder';

/** How far back having had lunch still makes somebody worth asking. */
const RECENT_DAYS = 28;

export interface ReminderOutcome {
  officeId: string;
  date: string;
  asked: number;
  alreadyIn: number;
  optedOut: number;
  /** Nothing suggests they would want it: no recent lunch, no calendar entry. */
  notLikely: number;
  alreadyAsked: number;
  failed: { employeeId: string; reason: string }[];
}

/**
 * The evening-before question, to the people it is worth asking.
 *
 * Only people based at the office who have not already said yes or no for that
 * day, who have not turned these off, and who either had lunch through Sofra in
 * the last four weeks or whose calendar says they will be in. Asking everyone
 * in the building every evening is how a product gets a mail rule written for
 * it. Once per person per day, recorded only after it went.
 */
export async function sendEveningReminders(
  db: Db,
  channel: InviteChannel,
  office: Office,
  date: string,
): Promise<ReminderOutcome> {
  const outcome: ReminderOutcome = {
    officeId: office.id,
    date,
    asked: 0,
    alreadyIn: 0,
    optedOut: 0,
    notLikely: 0,
    alreadyAsked: 0,
    failed: [],
  };
  if (!channel.sendReminder) return outcome;

  const people = await listMatchablePeople(db, office.id);
  const decided = await decidedFor(
    db,
    people.map((p) => p.id),
    date,
  );
  const recent = await recentDiners(db, office.id, addDays(date, -RECENT_DAYS));
  const hinted = await hintedFor(db, office.id, date);
  const told = await listNotified(db, REMINDER_KIND, office.id, date);
  const closesAt = formatLocalTime(matchInstant(office, date), office.timeZone);
  const delivered: string[] = [];

  for (const person of people) {
    if (decided.has(person.id)) {
      outcome.alreadyIn++;
      continue;
    }
    if (!person.reminders) {
      outcome.optedOut++;
      continue;
    }
    const because = hinted.has(person.id) ? 'calendar' : recent.has(person.id) ? 'recent' : null;
    if (!because) {
      outcome.notLikely++;
      continue;
    }
    if (told.has(person.id)) {
      outcome.alreadyAsked++;
      continue;
    }

    try {
      await channel.sendReminder({
        ...buildReminder({
          employee: toEmployee(person, office.id),
          venue: venueOf(office),
          date,
          dayLabel: formatDay(date),
          optInUrl: `${BASE_URL}/?day=${date}#${date}`,
          settingsUrl: `${BASE_URL}/you`,
          closesAt,
          because,
        }),
        offer: {
          date,
          officeId: office.id,
          officeName: office.name,
          dayLabel: formatDay(date),
          closesAt,
        },
      });
      delivered.push(person.id);
      outcome.asked++;
    } catch (error) {
      outcome.failed.push({ employeeId: person.id, reason: describe(error) });
    }
  }

  await recordNotified(db, REMINDER_KIND, office.id, date, delivered);
  return outcome;
}

/**
 * People who have already said something about the day: asked for it (at any
 * office), or skipped it. Neither should be asked again.
 */
async function decidedFor(db: Db, ids: readonly string[], date: string): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const { rows } = await db.query<{ employee_id: string }>(
    `SELECT employee_id FROM lunch_requests WHERE date = $1 AND employee_id = ANY($2)
     UNION
     SELECT employee_id FROM request_skips WHERE date = $1 AND employee_id = ANY($2)
     UNION
     SELECT p.employee_id FROM weekly_patterns p
      WHERE p.employee_id = ANY($2) AND $3 = ANY(p.weekdays)`,
    [date, [...ids], isoWeekdayOf(date)],
  );
  return new Set(rows.map((r) => r.employee_id));
}

function isoWeekdayOf(date: string): number {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return day === 0 ? 7 : day;
}

import type { InviteChannel } from '../notify/channels';
import { buildReminder } from '../notify/reminder';
import type { Store } from '../store/types';
import { BASE_URL } from './config';
import { formatDay, nextWeekday, todayInZone } from './dates';
import { toVenue } from './venue';

/** The `kind` under which a sent reminder is recorded, so it goes out once. */
export const REMINDER_KIND = 'reminder';

export interface ReminderOptions {
  store: Store;
  channel: InviteChannel;
  /** Override the day being offered. Defaults to each office's next weekday. */
  date?: string;
}

export interface ReminderOutcome {
  officeId: string;
  date: string;
  /** People the desk system says will be in that day. */
  inTheBuilding: number;
  sent: number;
  /** Already ticked the box, so there is nothing to ask. */
  alreadyIn: number;
  /** Asked already, on an earlier run for the same day. */
  alreadyAsked: number;
  /** Turned reminders off. */
  optedOut: number;
  failed: { employeeId: string; reason: string }[];
}

/**
 * The message that has to go out before anything else in Sofra happens.
 *
 * Every other part of the product waits for somebody to have ticked a box on a
 * page they have no reason to visit. A company that installs this and sends
 * nothing gets a handful of enthusiasts in week one and silence in week two. So
 * once a day, everyone the desk booking says will be in tomorrow, who has not
 * answered and has not turned these off, gets one short question.
 *
 * Three things keep it from being spam, and all three are load-bearing: it only
 * goes to people who are already coming in, it goes at most once per person per
 * day, and it carries its own off switch.
 */
export async function sendReminders(options: ReminderOptions): Promise<ReminderOutcome[]> {
  const { store, channel } = options;
  const outcomes: ReminderOutcome[] = [];

  // A channel with no way to address one person cannot do this at all, and
  // pretending otherwise would report sends that never happened.
  if (!channel.sendReminder) return outcomes;

  const remindersOff = new Set(await store.listRemindersOff());

  for (const office of await store.listOffices()) {
    const date = options.date ?? nextWeekday(todayInZone(office.timeZone));

    const attending = await store.getAttendance(date, office.id);
    const optedIn = new Set((await store.listOptIns(date, office.id)).map((o) => o.employeeId));
    const asked = new Set(await store.listNotified(REMINDER_KIND, date, office.id));

    const outcome: ReminderOutcome = {
      officeId: office.id,
      date,
      inTheBuilding: attending.length,
      sent: 0,
      alreadyIn: 0,
      alreadyAsked: 0,
      optedOut: 0,
      failed: [],
    };

    const venue = toVenue(office);
    const dayLabel = formatDay(date);
    const delivered: string[] = [];

    for (const employeeId of attending) {
      if (optedIn.has(employeeId)) {
        outcome.alreadyIn++;
        continue;
      }
      if (asked.has(employeeId)) {
        outcome.alreadyAsked++;
        continue;
      }
      if (remindersOff.has(employeeId)) {
        outcome.optedOut++;
        continue;
      }

      const employee = await store.getEmployee(employeeId);
      if (!employee) continue;

      try {
        await channel.sendReminder({
          ...buildReminder({
            employee,
            venue,
            date,
            dayLabel,
            optInUrl: `${BASE_URL}/?day=${date}#${date}`,
            settingsUrl: `${BASE_URL}/you`,
          }),
        });
        delivered.push(employeeId);
        outcome.sent++;
      } catch (error) {
        // Not recorded, so tomorrow's run tries again rather than treating a
        // bounced address as somebody who was asked and said nothing.
        outcome.failed.push({ employeeId, reason: describe(error) });
      }
    }

    await store.recordNotified(REMINDER_KIND, date, office.id, delivered);
    outcomes.push(outcome);
  }

  return outcomes;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

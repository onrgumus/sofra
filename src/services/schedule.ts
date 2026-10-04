import type { Office } from '../data/types';
import { addDays, isoWeekday, localNow, minutesOf, zonedTimeToUtc } from '../lib/zoned';

/**
 * When things happen at an office, as instants.
 *
 * The rules, all in the office's own zone:
 *   - Tables for a day are made `matchLeadMinutes` before the office opens that
 *     morning, so the invite is waiting before anybody arrives.
 *   - Until then anybody can ask for, or drop, a lunch that day.
 *   - After that, until `confirmBy`, somebody late can still take a free seat,
 *     and somebody dropping out has the table reseated.
 *   - After `confirmBy` the tables are what they are.
 *   - The evening before (the previous working day, so Friday for a Monday),
 *     at `reminderAt`, the people likely to want lunch are asked.
 *
 * Pure: every function takes the time it is asked about, so a test can stand
 * anywhere on the calendar, including either side of a clock change.
 */

export type Holidays = ReadonlySet<string>;

export function isWorkingDay(office: Office, date: string, holidays: Holidays): boolean {
  return office.workingDays.includes(isoWeekday(date)) && !holidays.has(date);
}

/** The working day before `date`: Friday for a Monday, and past any holiday. */
export function previousWorkingDay(office: Office, date: string, holidays: Holidays): string {
  let cursor = addDays(date, -1);
  for (let i = 0; i < 31; i++) {
    if (isWorkingDay(office, cursor, holidays)) return cursor;
    cursor = addDays(cursor, -1);
  }
  return addDays(date, -1);
}

/** The next `count` working days starting at `from`, included when it is one. */
export function workingDaysFrom(
  office: Office,
  from: string,
  count: number,
  holidays: Holidays,
): string[] {
  const days: string[] = [];
  let cursor = from;
  // An office open one day a week still fills a four-week view.
  for (let i = 0; days.length < count && i < count * 7 + 7; i++) {
    if (isWorkingDay(office, cursor, holidays)) days.push(cursor);
    cursor = addDays(cursor, 1);
  }
  return days;
}

export function matchInstant(office: Office, date: string): Date {
  const opens = zonedTimeToUtc(date, office.opensAt, office.timeZone);
  return new Date(opens.getTime() - office.matchLeadMinutes * 60_000);
}

export function confirmInstant(office: Office, date: string): Date {
  return zonedTimeToUtc(date, office.confirmBy, office.timeZone);
}

export function lunchInstant(office: Office, date: string, slot: string): Date {
  return zonedTimeToUtc(date, slot, office.timeZone);
}

export function firstLunchInstant(office: Office, date: string): Date {
  return lunchInstant(office, date, office.lunchSlots[0] ?? '12:00');
}

export function reminderInstant(office: Office, date: string, holidays: Holidays): Date {
  return zonedTimeToUtc(
    previousWorkingDay(office, date, holidays),
    office.reminderAt,
    office.timeZone,
  );
}

/**
 * Where a day stands for somebody who wants to change their mind about it.
 *
 *   open      requests are still being collected
 *   matched   tables exist, on schedule or made early by hand; a late request can
 *             take a free seat, a drop-out reseats
 *   closed    past the reply cut-off, tables are final
 *   past      lunch has happened
 *   off       not a working day here
 */
export type DayPhase = 'open' | 'matched' | 'closed' | 'past' | 'off';

export function dayPhase(
  office: Office,
  date: string,
  holidays: Holidays,
  now: Date,
  /** The day already has tables: an admin made them early, by hand. */
  planned = false,
): DayPhase {
  if (!isWorkingDay(office, date, holidays)) return 'off';
  const t = now.getTime();
  const lastSlot = office.lunchSlots[office.lunchSlots.length - 1] ?? '12:00';
  if (t >= lunchInstant(office, date, lastSlot).getTime()) return 'past';
  if (t >= confirmInstant(office, date).getTime()) return 'closed';
  if (planned || t >= matchInstant(office, date).getTime()) return 'matched';
  return 'open';
}

/** The office's own "today". */
export function officeToday(office: Office, now: Date): string {
  return localNow(office.timeZone, now).date;
}

/**
 * The problems with an office's timetable, in words an admin can act on.
 * Empty when it holds together.
 */
export function timetableProblems(office: Office): string[] {
  const problems: string[] = [];
  const matchAt = minutesOf(office.opensAt) - office.matchLeadMinutes;
  const confirm = minutesOf(office.confirmBy);
  const first = minutesOf(office.lunchSlots[0] ?? '12:00');

  if (confirm <= matchAt) {
    problems.push('Replies close before the tables are even made. Move the reply cut-off later.');
  }
  if (confirm > first) {
    problems.push('Replies close after the first lunch has started. Move the cut-off earlier.');
  }
  if (office.workingDays.length === 0) {
    problems.push('The office has no working days, so no lunch would ever be planned.');
  }
  return problems;
}

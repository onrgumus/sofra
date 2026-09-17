const MS_PER_DAY = 86_400_000;

/**
 * Today's date in a given office's timezone.
 *
 * "Today" is not a property of the server. An Istanbul office and an Amsterdam
 * one are on different dates for part of every day, and deriving it from the
 * server's UTC clock made the app show yesterday to anyone in Istanbul between
 * midnight and 03:00, offering them a lunch that had already happened.
 */
export function todayInZone(timeZone: string, now: Date = new Date()): string {
  // en-CA formats as YYYY-MM-DD, which is exactly the shape we store.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

export function isWeekend(isoDate: string): boolean {
  const day = new Date(`${isoDate}T00:00:00Z`).getUTCDay();
  return day === 0 || day === 6;
}

export function addDays(isoDate: string, days: number): string {
  return new Date(Date.parse(`${isoDate}T00:00:00Z`) + days * MS_PER_DAY)
    .toISOString()
    .slice(0, 10);
}

/** `count` weekdays starting at `fromIso` (included when it is a weekday). */
export function upcomingWeekdays(count: number, fromIso: string): string[] {
  const days: string[] = [];
  let cursor = fromIso;

  while (days.length < count) {
    if (!isWeekend(cursor)) days.push(cursor);
    cursor = addDays(cursor, 1);
  }
  return days;
}

/**
 * The first weekday strictly after `fromIso`.
 *
 * What a job running today is planning for. `upcomingWeekdays(1, today)` is not
 * it: that returns today whenever today is a weekday, so the evening job would
 * plan a lunch five hours after it happened and the morning reminder would ask
 * about a table that is already sitting down.
 */
export function nextWeekday(fromIso: string): string {
  return upcomingWeekdays(1, addDays(fromIso, 1))[0]!;
}

/** The `count` weekdays before `beforeIso`, oldest first. Used to seed history. */
export function pastWeekdays(count: number, beforeIso: string): string[] {
  const days: string[] = [];
  let cursor = addDays(beforeIso, -1);

  while (days.length < count) {
    if (!isWeekend(cursor)) days.unshift(cursor);
    cursor = addDays(cursor, -1);
  }
  return days;
}

/**
 * The long form, for a message that has to say which day it means.
 *
 * The invite goes out the evening before, so "today" in it was a lie to every
 * recipient. Naming the day is the only form that is true whenever it is sent,
 * and it has to be true in the language the invite is written in.
 */
export function formatDayLong(isoDate: string, locale = 'en-GB'): string {
  return new Date(`${isoDate}T00:00:00Z`).toLocaleDateString(locale, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  });
}

/**
 * Wall-clock time where an office is, as 'YYYY-MM-DD HH:mm'.
 *
 * Sortable as a string because every part is zero-padded, which is all that is
 * needed to answer "has that moment passed there yet".
 */
export function localStamp(timeZone: string, now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now);

  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? '00';

  // Midnight comes back as 24 in some environments; 00 is what sorts correctly.
  const hour = get('hour') === '24' ? '00' : get('hour');
  return `${get('year')}-${get('month')}-${get('day')} ${hour}:${get('minute')}`;
}

/**
 * Whether matching for a day has already been and gone.
 *
 * The employee page promised "your table appears after 17:00 on <the previous
 * weekday>", which for today is a moment that has already passed: it was
 * telling people to wait for something that was never going to happen.
 */
export function cutOffPassed(
  isoDate: string,
  timeZone: string,
  matchingHour: string,
  now: Date = new Date(),
): boolean {
  return localStamp(timeZone, now) >= `${previousWeekday(isoDate)} ${matchingHour}`;
}

export function formatDay(isoDate: string, locale = 'en-GB'): string {
  return new Date(`${isoDate}T00:00:00Z`).toLocaleDateString(locale, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
}

/** The working day before `isoDate`. Friday for a Monday, not Sunday. */
export function previousWeekday(isoDate: string): string {
  let cursor = addDays(isoDate, -1);
  while (isWeekend(cursor)) cursor = addDays(cursor, -1);
  return cursor;
}

/**
 * A length of service the way somebody would say it out loud.
 *
 * The directory counts months because that is what arithmetic wants. "101
 * months" is not something a person has ever said about their own job, and it
 * was on the page where somebody checks what the company holds about them.
 */
export function formatTenure(months: number): string {
  if (months < 1) return 'less than a month';
  if (months < 18) return months === 1 ? '1 month' : `${months} months`;

  const years = Math.floor(months / 12);
  const rest = months % 12;
  const yearPart = years === 1 ? '1 year' : `${years} years`;
  if (rest === 0) return yearPart;

  return `${yearPart}, ${rest === 1 ? '1 month' : `${rest} months`}`;
}

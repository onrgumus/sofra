const MS_PER_DAY = 86_400_000;

/**
 * Today's date in a given office's timezone.
 *
 * "Today" is not a property of the server. An Istanbul office and an Amsterdam
 * one are on different dates for part of every day, and deriving it from the
 * server's UTC clock made the app show yesterday to anyone in Istanbul between
 * midnight and 03:00 — offering them a lunch that had already happened.
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

export function formatDay(isoDate: string, locale = 'en-GB'): string {
  return new Date(`${isoDate}T00:00:00Z`).toLocaleDateString(locale, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
}

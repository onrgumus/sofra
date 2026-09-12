const MS_PER_DAY = 86_400_000;

export function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function isWeekend(isoDate: string): boolean {
  const day = new Date(`${isoDate}T00:00:00Z`).getUTCDay();
  return day === 0 || day === 6;
}

/** The next `count` weekdays, starting today if today is one. */
export function upcomingWeekdays(count: number, from: Date = new Date()): string[] {
  const days: string[] = [];
  let cursor = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate());

  while (days.length < count) {
    const iso = toIsoDate(new Date(cursor));
    if (!isWeekend(iso)) days.push(iso);
    cursor += MS_PER_DAY;
  }
  return days;
}

/** The `count` weekdays before `from`, oldest first. Used to seed history. */
export function pastWeekdays(count: number, from: Date = new Date()): string[] {
  const days: string[] = [];
  let cursor = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()) - MS_PER_DAY;

  while (days.length < count) {
    const iso = toIsoDate(new Date(cursor));
    if (!isWeekend(iso)) days.unshift(iso);
    cursor -= MS_PER_DAY;
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

export function weekdayName(isoDate: string, locale = 'en-GB'): string {
  return new Date(`${isoDate}T00:00:00Z`).toLocaleDateString(locale, {
    weekday: 'long',
    timeZone: 'UTC',
  });
}

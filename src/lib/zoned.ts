import type { Weekday } from '../data/types';

/**
 * Wall-clock time in an office's zone.
 *
 * Every schedule in Sofra is local to an office: when it opens, when tables are
 * made, when replies close. The server's own clock is UTC and means nothing to
 * anybody, so everything here converts between the two through the IANA zone,
 * which is also what makes a daylight-saving change move nothing that should
 * stay put.
 */

const TIME = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isValidTime(value: string): boolean {
  return TIME.test(value);
}

export function isValidDate(value: string): boolean {
  if (!DATE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function isValidTimeZone(timeZone: string): boolean {
  if (!timeZone || /^[+-]?\d/.test(timeZone)) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

/** Every zone the runtime knows, for the office form's picker. */
export function timeZones(): string[] {
  const supported = (Intl as unknown as { supportedValuesOf?: (key: string) => string[] })
    .supportedValuesOf;
  return supported ? supported('timeZone') : ['UTC', 'Europe/Istanbul', 'Europe/London'];
}

/** 'HH:MM' to minutes after midnight. */
export function minutesOf(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

/** Minutes after midnight to 'HH:MM', wrapping around the day. */
export function timeOf(minutes: number): string {
  const wrapped = ((minutes % 1440) + 1440) % 1440;
  return `${String(Math.floor(wrapped / 60)).padStart(2, '0')}:${String(wrapped % 60).padStart(2, '0')}`;
}

/** The local date and time in a zone at an instant. */
export function localNow(timeZone: string, now: Date = new Date()): { date: string; time: string } {
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
  // Midnight is "24" in some environments.
  const hour = get('hour') === '24' ? '00' : get('hour');
  return { date: `${get('year')}-${get('month')}-${get('day')}`, time: `${hour}:${get('minute')}` };
}

/**
 * A wall-clock time in a zone as an instant. The second pass settles times
 * near a daylight-saving transition; a time that does not exist that day (the
 * hour skipped in spring) lands just after the gap, which is what a person
 * would expect of "02:30" on that morning.
 */
export function zonedTimeToUtc(date: string, time: string, timeZone: string): Date {
  const naive = Date.parse(`${date}T${time}:00Z`);
  if (Number.isNaN(naive)) throw new Error(`Invalid date/time: ${date} ${time}`);

  let timestamp = naive - zoneOffsetMs(new Date(naive), timeZone);
  timestamp = naive - zoneOffsetMs(new Date(timestamp), timeZone);
  return new Date(timestamp);
}

function zoneOffsetMs(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant);

  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? '0');
  const asUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour') % 24,
    get('minute'),
    get('second'),
  );
  return asUtc - instant.getTime();
}

export function addDays(isoDate: string, days: number): string {
  return new Date(Date.parse(`${isoDate}T00:00:00Z`) + days * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

/** 1 for Monday through 7 for Sunday. */
export function isoWeekday(isoDate: string): Weekday {
  const day = new Date(`${isoDate}T00:00:00Z`).getUTCDay();
  return (day === 0 ? 7 : day) as Weekday;
}

/** The Monday of the week a date falls in. */
export function startOfWeek(isoDate: string): string {
  return addDays(isoDate, 1 - isoWeekday(isoDate));
}

/** An instant as 'HH:MM' in a zone, for messages that say when something happens. */
export function formatLocalTime(instant: Date, timeZone: string): string {
  return localNow(timeZone, instant).time;
}

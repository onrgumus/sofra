import type { Queryable } from '../db';
import { calendarFetchedAt, saveCalendarHints } from '../data/messages';
import { listMatchablePeople } from '../data/people';
import type { Office, Person } from '../data/types';
import { envOptional } from '../lib/env';
import { addDays } from '../lib/zoned';

/** Authenticated GET against Graph, app-only with Calendars.Read. */
export type GraphGet = (path: string) => Promise<Record<string, unknown>>;

/** How long an Outlook read is good for before it is read again. */
const FRESH_MS = 60 * 60_000;

export function calendarHintsEnabled(): boolean {
  return envOptional('SOFRA_CALENDAR_HINTS') === 'outlook';
}

type GraphEvent = Record<string, unknown>;

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

function fold(value: string): string {
  return value.replace(/ı/g, 'i').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
}

/**
 * Which office, if any, an Outlook entry puts somebody in.
 *
 * Outlook's work-location feature marks a day "office"; desk-booking tools
 * write bookings as events named after the building. Either counts. An entry
 * that says "office" without saying which one is an office day somewhere,
 * returned as the empty string. Anything else is not an office day: erring
 * towards "no" costs a reminder, erring towards "yes" asks somebody working
 * from home whether they want lunch in a building they are not in.
 */
export function officeFromEvent(event: GraphEvent, offices: readonly Office[]): string | null {
  const working = record(event['workingLocation']);
  const type = (text(event['workingLocationType']) ?? text(working?.['type']))?.toLowerCase();
  if (type && type !== 'office') return null;

  const names = [
    text(record(event['location'])?.['displayName']),
    text(working?.['displayName']),
    text(event['subject']),
  ]
    .filter((n): n is string => n !== undefined)
    .map(fold);

  for (const office of offices) {
    const words = [office.name, office.id, ...office.locationKeywords].map(fold).filter(Boolean);
    if (names.some((n) => words.some((w) => n.includes(w)))) return office.id;
  }
  return type === 'office' ? '' : null;
}

/** The days an event covers: every day of an all-day entry, the start day of a timed one. */
export function daysOfEvent(event: GraphEvent): string[] {
  const start = text(record(event['start'])?.['dateTime'])?.slice(0, 10);
  const end = text(record(event['end'])?.['dateTime'])?.slice(0, 10);
  if (!start) return [];
  if (event['isAllDay'] !== true || !end || end <= start) return [start];

  const days: string[] = [];
  for (let d = start; d < end && days.length < 31; d = addDays(d, 1)) days.push(d);
  return days;
}

/** Reads somebody's Outlook for a range of days and stores what it says. */
export async function refreshHints(
  db: Queryable,
  graphGet: GraphGet,
  person: Person,
  offices: readonly Office[],
  range: { from: string; to: string },
): Promise<void> {
  const user = encodeURIComponent(person.entraObjectId ?? person.email);
  const path =
    `/users/${user}/calendarView?startDateTime=${range.from}T00:00:00Z` +
    `&endDateTime=${addDays(range.to, 1)}T00:00:00Z&$top=200`;

  const response = await graphGet(path);
  const events = Array.isArray(response['value']) ? (response['value'] as GraphEvent[]) : [];

  const byDay = new Map<string, string | null>();
  for (const event of events) {
    const office = officeFromEvent(event, offices);
    if (office === null) continue;
    for (const day of daysOfEvent(event)) {
      if (day < range.from || day > range.to) continue;
      // A named office beats "some office" on the same day.
      if (!byDay.get(day)) byDay.set(day, office || null);
    }
  }

  await saveCalendarHints(
    db,
    person.id,
    range,
    [...byDay].map(([date, officeId]) => ({ date, officeId })),
  );
}

/** Refreshes somebody's hints unless they were read within the hour. Never throws. */
export async function ensureFreshHints(
  db: Queryable,
  graphGet: GraphGet | null,
  person: Person,
  offices: readonly Office[],
  range: { from: string; to: string },
): Promise<void> {
  if (!graphGet || !calendarHintsEnabled()) return;
  const fetched = await calendarFetchedAt(db, person.id, range.from, range.to);
  if (fetched && Date.now() - fetched.getTime() < FRESH_MS) return;
  try {
    await refreshHints(db, graphGet, person, offices, range);
  } catch (error) {
    // A mailbox Sofra cannot read is somebody without hints, not an error page.
    console.warn(`[sofra] calendar read failed for ${person.email}:`, error);
  }
}

/**
 * Everybody at an office, for one day, before the evening question: a few at
 * a time, because Graph throttles an app that asks for a whole building at
 * once.
 */
export async function refreshOfficeHints(
  db: Queryable,
  graphGet: GraphGet,
  office: Office,
  offices: readonly Office[],
  date: string,
): Promise<void> {
  const people = (await listMatchablePeople(db, office.id)).filter((p) => p.reminders);
  for (let i = 0; i < people.length; i += 5) {
    await Promise.all(
      people
        .slice(i, i + 5)
        .map((p) => ensureFreshHints(db, graphGet, p, offices, { from: date, to: date })),
    );
  }
}

/**
 * RFC 5545 invite generation.
 *
 * Why ICS rather than the Teams or Google Calendar API: an .ics attachment with
 * METHOD:REQUEST is accepted by Outlook, Teams, Google Calendar and Apple
 * Calendar alike. It needs no tenant admin consent, no per-company app
 * registration, and no calendar write scope — which is the whole point of a tool
 * that has to work at every company.
 */

export interface IcsAttendee {
  name: string;
  email: string;
}

export interface IcsInvite {
  uid: string;
  /** ISO date, e.g. '2026-09-16'. */
  date: string;
  /** Local start time in `timeZone`, e.g. '12:00'. */
  startTime: string;
  durationMinutes: number;
  /** IANA zone of the office, e.g. 'Europe/Istanbul'. */
  timeZone: string;
  summary: string;
  description: string;
  location: string;
  organizer: IcsAttendee;
  attendees: readonly IcsAttendee[];
  /** Bump when re-sending a changed invite so clients update instead of duplicating. */
  sequence?: number;
  method?: 'REQUEST' | 'CANCEL';
}

export function buildIcs(invite: IcsInvite): string {
  const start = zonedTimeToUtc(invite.date, invite.startTime, invite.timeZone);
  const end = new Date(start.getTime() + invite.durationMinutes * 60_000);
  const method = invite.method ?? 'REQUEST';

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Sofra//Lunch Matching//EN',
    'CALSCALE:GREGORIAN',
    `METHOD:${method}`,
    'BEGIN:VEVENT',
    `UID:${invite.uid}`,
    `DTSTAMP:${formatUtc(new Date())}`,
    `DTSTART:${formatUtc(start)}`,
    `DTEND:${formatUtc(end)}`,
    `SEQUENCE:${invite.sequence ?? 0}`,
    `SUMMARY:${escapeText(invite.summary)}`,
    `DESCRIPTION:${escapeText(invite.description)}`,
    `LOCATION:${escapeText(invite.location)}`,
    `ORGANIZER;CN=${escapeText(invite.organizer.name)}:mailto:${invite.organizer.email}`,
    ...invite.attendees.map(
      (a) =>
        `ATTENDEE;CN=${escapeText(a.name)};ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:${a.email}`,
    ),
    method === 'CANCEL' ? 'STATUS:CANCELLED' : 'STATUS:CONFIRMED',
    'TRANSP:OPAQUE',
    'END:VEVENT',
    'END:VCALENDAR',
  ];

  return lines.flatMap(foldLine).join('\r\n') + '\r\n';
}

function formatUtc(date: Date): string {
  return date
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');
}

/** Escapes the characters RFC 5545 reserves inside TEXT values. */
function escapeText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

/** Content lines are limited to 75 octets; continuations start with a space. */
function foldLine(line: string): string[] {
  const bytes = Buffer.from(line, 'utf8');
  if (bytes.length <= 75) return [line];

  const out: string[] = [];
  let offset = 0;
  let limit = 75;
  while (offset < bytes.length) {
    // Never split a multi-byte character across a fold.
    let end = Math.min(offset + limit, bytes.length);
    while (end > offset && end < bytes.length && (bytes[end]! & 0xc0) === 0x80) end--;
    out.push((out.length === 0 ? '' : ' ') + bytes.subarray(offset, end).toString('utf8'));
    offset = end;
    limit = 74; // the leading space counts towards the next line's octets
  }
  return out;
}

/**
 * Converts a wall-clock time in an IANA zone to UTC without a date library.
 * The second pass settles times that sit near a DST transition.
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

import { describe, expect, it } from 'vitest';
import { buildIcs, zonedTimeToUtc } from '../src/notify/ics.js';

const base = {
  uid: 'group-1@sofra',
  date: '2026-09-16',
  startTime: '12:00',
  durationMinutes: 60,
  timeZone: 'Europe/Istanbul',
  summary: 'Lunch',
  description: 'Line one\nLine two',
  location: 'HQ, ground floor; by the coffee bar',
  organizer: { name: 'Sofra', email: 'sofra@example.com' },
  attendees: [
    { name: 'Ada Yılmaz', email: 'ada@example.com' },
    { name: 'Bruno Costa', email: 'bruno@example.com' },
  ],
};

describe('zonedTimeToUtc', () => {
  it('converts a wall-clock time in a fixed-offset zone', () => {
    // Istanbul is UTC+3 year round.
    expect(zonedTimeToUtc('2026-09-16', '12:00', 'Europe/Istanbul').toISOString()).toBe(
      '2026-09-16T09:00:00.000Z',
    );
  });

  it('respects daylight saving in zones that observe it', () => {
    expect(zonedTimeToUtc('2026-07-15', '12:00', 'Europe/Amsterdam').toISOString()).toBe(
      '2026-07-15T10:00:00.000Z',
    );
    expect(zonedTimeToUtc('2026-01-15', '12:00', 'Europe/Amsterdam').toISOString()).toBe(
      '2026-01-15T11:00:00.000Z',
    );
  });
});

describe('buildIcs', () => {
  const ics = buildIcs(base);

  it('emits a well-formed request with CRLF line endings', () => {
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(ics.trimEnd().endsWith('END:VCALENDAR')).toBe(true);
    expect(ics).toContain('METHOD:REQUEST');
    expect(ics).toContain('UID:group-1@sofra');
  });

  it('writes start and end in UTC', () => {
    expect(ics).toContain('DTSTART:20260916T090000Z');
    expect(ics).toContain('DTEND:20260916T100000Z');
  });

  it('invites every attendee with RSVP requested', () => {
    expect(unfold(ics)).toContain(
      'ATTENDEE;CN=Ada Yılmaz;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:ada@example.com',
    );
    expect(ics.match(/^ATTENDEE/gm)?.length).toBe(2);
  });

  it('escapes the characters RFC 5545 reserves', () => {
    expect(unfold(ics)).toContain('LOCATION:HQ\\, ground floor\\; by the coffee bar');
    expect(unfold(ics)).toContain('DESCRIPTION:Line one\\nLine two');
  });

  it('folds content lines to 75 octets', () => {
    const long = buildIcs({ ...base, description: 'x'.repeat(400) });
    for (const line of long.split('\r\n')) {
      expect(Buffer.from(line, 'utf8').length).toBeLessThanOrEqual(75);
    }
  });

  it('keeps multi-byte characters intact across a fold', () => {
    const long = buildIcs({ ...base, summary: 'ğüşıöç'.repeat(40) });
    expect(unfold(long)).toContain('SUMMARY:' + 'ğüşıöç'.repeat(40));
  });

  it('marks cancellations so clients remove the event', () => {
    const cancelled = buildIcs({ ...base, method: 'CANCEL', sequence: 1 });
    expect(cancelled).toContain('METHOD:CANCEL');
    expect(cancelled).toContain('STATUS:CANCELLED');
    expect(cancelled).toContain('SEQUENCE:1');
  });
});

/** Reverses RFC 5545 line folding. */
function unfold(ics: string): string {
  return ics.replace(/\r\n /g, '');
}

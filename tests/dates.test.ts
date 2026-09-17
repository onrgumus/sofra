import { describe, expect, it } from 'vitest';
import {
  addDays,
  cutOffPassed,
  formatTenure,
  isWeekend,
  nextWeekday,
  pastWeekdays,
  todayInZone,
  upcomingWeekdays,
} from '../src/lib/dates';

describe('todayInZone', () => {
  it('uses the office clock, not the server clock', () => {
    // 22:00 UTC is already the next day in Istanbul but not in Amsterdam.
    const instant = new Date('2026-09-15T22:00:00Z');
    expect(todayInZone('Europe/Istanbul', instant)).toBe('2026-09-16');
    expect(todayInZone('Europe/Amsterdam', instant)).toBe('2026-09-16');
    expect(todayInZone('America/New_York', instant)).toBe('2026-09-15');
  });

  it('does not show yesterday to someone up late in Istanbul', () => {
    // The bug this replaced: 01:00 local read as the previous UTC day, so the
    // app offered a lunch that had already happened.
    const oneAm = new Date('2026-09-15T22:00:00Z');
    expect(upcomingWeekdays(1, todayInZone('Europe/Istanbul', oneAm))[0]).toBe('2026-09-16');
  });
});

describe('upcomingWeekdays', () => {
  it('includes today when today is a weekday', () => {
    expect(upcomingWeekdays(1, '2026-09-16')).toEqual(['2026-09-16']);
  });

  it('skips the weekend', () => {
    // 2026-09-18 is a Friday.
    expect(upcomingWeekdays(3, '2026-09-18')).toEqual(['2026-09-18', '2026-09-21', '2026-09-22']);
  });

  it('starts on Monday when asked from a Saturday', () => {
    expect(upcomingWeekdays(1, '2026-09-19')).toEqual(['2026-09-21']);
  });

  it('returns exactly the number of days asked for', () => {
    expect(upcomingWeekdays(10, '2026-09-16')).toHaveLength(10);
  });
});

describe('pastWeekdays', () => {
  it('returns weekdays before the given day, oldest first', () => {
    // The Monday before Wednesday 2026-09-16 is the 14th.
    const days = pastWeekdays(3, '2026-09-16');
    expect(days).toEqual(['2026-09-11', '2026-09-14', '2026-09-15']);
  });

  it('never includes the day itself', () => {
    expect(pastWeekdays(5, '2026-09-16')).not.toContain('2026-09-16');
  });
});

describe('addDays', () => {
  it('crosses month and year boundaries', () => {
    expect(addDays('2026-09-30', 1)).toBe('2026-10-01');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
  });

  it('is unaffected by daylight saving', () => {
    // Europe switches on 2026-10-25; pure date arithmetic must not shift.
    expect(addDays('2026-10-24', 2)).toBe('2026-10-26');
  });
});

describe('isWeekend', () => {
  it('knows Saturday and Sunday', () => {
    expect(isWeekend('2026-09-19')).toBe(true);
    expect(isWeekend('2026-09-20')).toBe(true);
    expect(isWeekend('2026-09-21')).toBe(false);
  });
});

describe('nextWeekday', () => {
  it('never returns the day it was given', () => {
    // The whole point: a job running today plans tomorrow. Returning today
    // meant the evening run planned a lunch that had already happened.
    expect(nextWeekday('2026-09-16')).toBe('2026-09-17');
  });

  it('skips the weekend from either side of it', () => {
    expect(nextWeekday('2026-09-18')).toBe('2026-09-21'); // Friday to Monday
    expect(nextWeekday('2026-09-19')).toBe('2026-09-21'); // Saturday to Monday
    expect(nextWeekday('2026-09-20')).toBe('2026-09-21'); // Sunday to Monday
  });
});

describe('formatTenure', () => {
  it('counts in months while months are how anybody would say it', () => {
    expect(formatTenure(1)).toBe('1 month');
    expect(formatTenure(5)).toBe('5 months');
    expect(formatTenure(17)).toBe('17 months');
  });

  it('switches to years, because nobody says 101 months about their own job', () => {
    // It was on the page where somebody checks what the company holds on them.
    expect(formatTenure(101)).toBe('8 years, 5 months');
    expect(formatTenure(24)).toBe('2 years');
    expect(formatTenure(25)).toBe('2 years, 1 month');
  });

  it('has something to say about somebody who just started', () => {
    expect(formatTenure(0)).toBe('less than a month');
  });
});

describe('cutOffPassed', () => {
  // The employee page promised "your table appears after 17:00 on the previous
  // weekday". For today that is a moment already gone: it was telling people to
  // wait for something that was never going to happen.
  const zone = 'Europe/Istanbul';
  const at = (iso: string) => new Date(iso);

  it('is past for a day whose evening before has gone', () => {
    expect(cutOffPassed('2026-09-17', zone, '17:00', at('2026-09-17T09:00:00Z'))).toBe(true);
  });

  it('is not past before the hour on the evening before', () => {
    // 13:00 UTC is 16:00 in Istanbul, an hour before the job runs.
    expect(cutOffPassed('2026-09-18', zone, '17:00', at('2026-09-17T13:00:00Z'))).toBe(false);
  });

  it('turns over exactly at the hour, in the office timezone', () => {
    expect(cutOffPassed('2026-09-18', zone, '17:00', at('2026-09-17T14:00:00Z'))).toBe(true);
  });

  it('counts back over a weekend rather than to yesterday', () => {
    // Monday's cut-off is Friday evening, not Sunday.
    expect(cutOffPassed('2026-09-21', zone, '17:00', at('2026-09-18T13:00:00Z'))).toBe(false);
    expect(cutOffPassed('2026-09-21', zone, '17:00', at('2026-09-18T15:00:00Z'))).toBe(true);
  });

  it('reads the clock where the office is, not where the server is', () => {
    const amsterdam = 'Europe/Amsterdam';
    // 15:30 UTC: 18:30 in Istanbul (past), 17:30 in Amsterdam (past),
    // but at 14:30 UTC it is 17:30 and 16:30 respectively.
    expect(cutOffPassed('2026-09-18', zone, '17:00', at('2026-09-17T14:30:00Z'))).toBe(true);
    expect(cutOffPassed('2026-09-18', amsterdam, '17:00', at('2026-09-17T14:30:00Z'))).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import { addDays, isWeekend, pastWeekdays, todayInZone, upcomingWeekdays } from '../src/lib/dates';

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

import { describe, expect, it } from 'vitest';
import {
  confirmInstant,
  dayPhase,
  isWorkingDay,
  matchInstant,
  previousWorkingDay,
  reminderInstant,
  timetableProblems,
  workingDaysFrom,
} from '../src/services/schedule';
import { assignSlots, officeConfig } from '../src/services/planning';
import { isoWeekday, localNow, startOfWeek, zonedTimeToUtc } from '../src/lib/zoned';
import { officeFixture } from './support/db';

const IST = officeFixture();
const NY = officeFixture({ id: 'NYC', timeZone: 'America/New_York', opensAt: '09:00' });
const none = new Set<string>();

describe('when tables are made', () => {
  it('is the lead before opening, in the office’s own zone', () => {
    expect(matchInstant(IST, '2026-10-05').toISOString()).toBe('2026-10-05T03:00:00.000Z');
    // New York is UTC-4 in October and UTC-5 in December.
    expect(matchInstant(NY, '2026-10-05').toISOString()).toBe('2026-10-05T10:00:00.000Z');
    expect(matchInstant(NY, '2026-12-07').toISOString()).toBe('2026-12-07T11:00:00.000Z');
  });

  it('falls on the evening before when the lead is longer than the night', () => {
    const early = officeFixture({ opensAt: '02:00', matchLeadMinutes: 180 });
    expect(matchInstant(early, '2026-10-06').toISOString()).toBe('2026-10-05T20:00:00.000Z');
  });

  it('keeps replies open until the cut-off, local', () => {
    expect(confirmInstant(IST, '2026-10-05').toISOString()).toBe('2026-10-05T07:00:00.000Z');
  });
});

describe('working days', () => {
  it('skips weekends and holidays in both directions', () => {
    const holidays = new Set(['2026-10-29']);
    expect(isWorkingDay(IST, '2026-10-29', holidays)).toBe(false);
    expect(isWorkingDay(IST, '2026-10-31', holidays)).toBe(false);
    // Friday 30th's previous working day skips the Thursday holiday.
    expect(previousWorkingDay(IST, '2026-10-30', holidays)).toBe('2026-10-28');
    // Monday's is Friday.
    expect(previousWorkingDay(IST, '2026-11-02', holidays)).toBe('2026-10-30');
    expect(workingDaysFrom(IST, '2026-10-28', 3, holidays)).toEqual([
      '2026-10-28',
      '2026-10-30',
      '2026-11-02',
    ]);
  });

  it('asks the evening before, on the previous working day', () => {
    expect(reminderInstant(IST, '2026-11-02', none).toISOString()).toBe('2026-10-30T13:00:00.000Z');
  });

  it('follows an office open on unusual days', () => {
    const weekend = officeFixture({ workingDays: [6, 7] });
    expect(workingDaysFrom(weekend, '2026-10-05', 2, none)).toEqual(['2026-10-10', '2026-10-11']);
  });
});

describe('where a day stands', () => {
  const at = (iso: string) => dayPhase(IST, '2026-10-05', none, new Date(iso));

  it('moves from open to matched to closed to past', () => {
    expect(at('2026-10-04T20:00:00Z')).toBe('open');
    expect(at('2026-10-05T02:59:00Z')).toBe('open');
    expect(at('2026-10-05T03:00:00Z')).toBe('matched');
    expect(at('2026-10-05T06:59:00Z')).toBe('matched');
    expect(at('2026-10-05T07:00:00Z')).toBe('closed');
    expect(at('2026-10-05T09:00:00Z')).toBe('past');
  });

  it('is off on a holiday', () => {
    expect(
      dayPhase(IST, '2026-10-05', new Set(['2026-10-05']), new Date('2026-10-04T00:00:00Z')),
    ).toBe('off');
  });
});

describe('a timetable that cannot work', () => {
  it('is caught before it is saved', () => {
    expect(timetableProblems(IST)).toEqual([]);
    expect(timetableProblems(officeFixture({ confirmBy: '05:00' }))[0]).toMatch(
      /before the tables/,
    );
    expect(timetableProblems(officeFixture({ confirmBy: '13:00' }))[0]).toMatch(
      /after the first lunch/,
    );
    expect(timetableProblems(officeFixture({ workingDays: [] }))[0]).toMatch(/no working days/);
  });
});

describe('lunch times', () => {
  it('fills a short time with flexible people before the popular one', () => {
    const requests = [
      ...['a', 'b', 'c', 'd'].map((id) => ({ employeeId: id, slot: '12:00' })),
      ...['e', 'f'].map((id) => ({ employeeId: id, slot: '13:00' })),
      { employeeId: 'g', slot: null },
      { employeeId: 'h', slot: null },
    ];
    const pools = assignSlots(requests, ['12:00', '13:00'], 3);
    expect(pools.get('13:00')).toEqual(['e', 'f', 'g']);
    expect(pools.get('12:00')).toEqual(['a', 'b', 'c', 'd', 'h']);
  });

  it('treats a time the office no longer has as any time', () => {
    const pools = assignSlots([{ employeeId: 'a', slot: '11:00' }], ['12:00'], 3);
    expect(pools.get('12:00')).toEqual(['a']);
  });

  it('matches with the office’s own table sizes', () => {
    expect(officeConfig(officeFixture({ minTable: 2, maxTable: 3 }))).toMatchObject({
      minGroupSize: 2,
      maxGroupSize: 3,
      groupSize: 3,
    });
    expect(officeConfig(IST)).toMatchObject({ minGroupSize: 3, maxGroupSize: 4, groupSize: 4 });
  });
});

describe('local time', () => {
  it('knows the date where the office is, not where the server is', () => {
    // 22:30 UTC is already the next day in Istanbul.
    expect(localNow('Europe/Istanbul', new Date('2026-10-05T22:30:00Z'))).toEqual({
      date: '2026-10-06',
      time: '01:30',
    });
  });

  it('turns a skipped spring hour into the moment just after it', () => {
    // 02:30 does not exist in Amsterdam on 2026-03-29.
    expect(zonedTimeToUtc('2026-03-29', '02:30', 'Europe/Amsterdam').toISOString()).toBe(
      '2026-03-29T01:30:00.000Z',
    );
  });

  it('counts weeks from Monday', () => {
    expect(isoWeekday('2026-10-04')).toBe(7);
    expect(startOfWeek('2026-10-04')).toBe('2026-09-28');
  });
});

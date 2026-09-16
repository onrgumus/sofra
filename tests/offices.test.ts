import { describe, expect, it } from 'vitest';
import { parseOffices } from '../src/lib/offices';

const ONE = JSON.stringify([
  {
    id: 'ANK-1',
    displayName: 'Ankara',
    timeZone: 'Europe/Istanbul',
    meetingPoint: 'Ground floor, by the lifts',
  },
]);

describe('parseOffices', () => {
  it('reads a configured office', () => {
    const offices = parseOffices(ONE)!;
    expect(offices).toHaveLength(1);
    expect(offices[0]).toEqual({
      id: 'ANK-1',
      displayName: 'Ankara',
      timeZone: 'Europe/Istanbul',
      meetingPoint: 'Ground floor, by the lifts',
    });
  });

  it('falls back to the demo offices when unset', () => {
    expect(parseOffices(undefined)).toBeNull();
    expect(parseOffices('')).toBeNull();
    expect(parseOffices('   ')).toBeNull();
  });

  it('refuses a timezone that is not real, rather than booting and being an hour out', () => {
    // A bad zone would not fail until the first invite, and then only by putting
    // the calendar entry at the wrong time, which nobody reports as a bug.
    const raw = JSON.stringify([
      { id: 'A', displayName: 'A', timeZone: 'Europe/Ankara', meetingPoint: 'Kitchen' },
    ]);
    expect(() => parseOffices(raw)).toThrow(/not a valid IANA zone/);
  });

  it('names the field and the position when something is missing', () => {
    const raw = JSON.stringify([
      { id: 'A', displayName: 'A', timeZone: 'Europe/Amsterdam', meetingPoint: 'Kitchen' },
      { id: 'B', displayName: 'B', timeZone: 'Europe/Amsterdam' },
    ]);
    expect(() => parseOffices(raw)).toThrow(/SOFRA_OFFICES\[1\]\.meetingPoint is required/);
  });

  it('refuses an empty list, which would match nobody anywhere', () => {
    expect(() => parseOffices('[]')).toThrow(/non-empty array/);
    expect(() => parseOffices('{}')).toThrow(/non-empty array/);
  });

  it('says so when the JSON is broken', () => {
    expect(() => parseOffices('[{')).toThrow(/not valid JSON/);
  });

  it('refuses a blank string where a name should be', () => {
    const raw = JSON.stringify([
      { id: '', displayName: 'A', timeZone: 'Europe/Amsterdam', meetingPoint: 'Kitchen' },
    ]);
    expect(() => parseOffices(raw)).toThrow(/\.id is required/);
  });
});

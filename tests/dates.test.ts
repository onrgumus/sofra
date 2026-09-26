import { describe, expect, it } from 'vitest';
import { formatDay, formatDayLong, formatTenure } from '../src/lib/dates';

describe('formatDay', () => {
  it("names the day, not the server's idea of it", () => {
    expect(formatDay('2026-10-05')).toBe('Mon 5 Oct');
    expect(formatDayLong('2026-10-05', 'tr-TR')).toBe('5 Ekim Pazartesi');
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

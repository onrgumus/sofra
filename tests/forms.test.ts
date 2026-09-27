import { describe, expect, it } from 'vitest';
import { parseOfficeForm, parseProfileForm } from '../src/services/forms';

function form(values: Record<string, string | string[]>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) {
    for (const v of Array.isArray(value) ? value : [value]) data.append(key, v);
  }
  return data;
}

const OFFICE = {
  id: 'IST-HQ',
  name: 'Istanbul HQ',
  address: 'Maslak',
  meetingPoint: 'Cafeteria',
  timeZone: 'Europe/Istanbul',
  opensAt: '09:00',
  matchLeadMinutes: '180',
  confirmBy: '10:00',
  reminderAt: '16:00',
  lunchSlots: '12:30, 12:00, 12:00',
  day1: 'on',
  day2: 'on',
  day3: 'on',
  day4: 'on',
  day5: 'on',
  minTable: '3',
  maxTable: '4',
  locationKeywords: 'Istanbul, Maslak',
  active: 'on',
};

describe('the office form', () => {
  it('reads a whole office', () => {
    const parsed = parseOfficeForm(form(OFFICE));
    expect(parsed).toEqual({
      ok: true,
      value: expect.objectContaining({
        id: 'IST-HQ',
        lunchSlots: ['12:00', '12:30'],
        workingDays: [1, 2, 3, 4, 5],
        matchLeadMinutes: 180,
        locationKeywords: ['istanbul', 'maslak'],
        active: true,
      }),
    });
  });

  it('keeps the id it was created with', () => {
    const parsed = parseOfficeForm(form({ ...OFFICE, id: 'SOMETHING-ELSE' }), 'IST-HQ');
    expect(parsed.ok && parsed.value.id).toBe('IST-HQ');
  });

  it('says what is wrong with each field, and gives back what was typed', () => {
    const parsed = parseOfficeForm(
      form({
        ...OFFICE,
        id: '-',
        name: '',
        timeZone: '+03:00',
        opensAt: '9am',
        lunchSlots: 'noon',
        day1: '',
        day2: '',
        day3: '',
        day4: '',
        day5: '',
        minTable: '5',
        maxTable: '4',
      }),
    );
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(Object.keys(parsed.errors).sort()).toEqual(
      ['id', 'lunchSlots', 'maxTable', 'name', 'opensAt', 'timeZone', 'workingDays'].sort(),
    );
    expect(parsed.values['name']).toBe('');
    expect(parsed.values['timeZone']).toBe('+03:00');
  });

  it('refuses a timetable whose replies close before the tables are made', () => {
    const parsed = parseOfficeForm(form({ ...OFFICE, confirmBy: '05:30' }));
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.errors['timetable']).toMatch(/before the tables/);
  });
});

describe('the profile form', () => {
  const context = { departments: ['Finance', 'Risk'], officeIds: ['IST'], today: '2026-09-26' };
  const PROFILE = {
    displayName: 'Ada Lovelace',
    title: 'Analyst',
    department: 'Finance',
    team: 'FP&A',
    seniority: 'junior',
    officeId: 'IST',
    languages: ['tr', 'en', 'xx'],
    interests: 'Chess, chess, Cycling',
    startedOn: '2024-03',
    reminders: 'on',
  };

  it('reads a whole profile, and keeps only languages it knows', () => {
    expect(parseProfileForm(form(PROFILE), context)).toEqual({
      ok: true,
      value: {
        displayName: 'Ada Lovelace',
        title: 'Analyst',
        department: 'Finance',
        team: 'FP&A',
        seniority: 'junior',
        officeId: 'IST',
        languages: ['tr', 'en'],
        interests: ['chess', 'cycling'],
        startedOn: '2024-03-01',
        reminders: true,
      },
    });
  });

  it('only takes a department and an office from the lists', () => {
    const parsed = parseProfileForm(
      form({ ...PROFILE, department: 'IT', officeId: 'MARS' }),
      context,
    );
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(Object.keys(parsed.errors).sort()).toEqual(['department', 'officeId']);
  });

  it('needs a language and a start in the past', () => {
    const parsed = parseProfileForm(
      form({ ...PROFILE, languages: [], startedOn: '2030-01' }),
      context,
    );
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(Object.keys(parsed.errors).sort()).toEqual(['languages', 'startedOn']);
  });
});

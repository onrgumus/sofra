import { parseInterests } from '../core/profile';
import { SENIORITY_LADDER, type Seniority } from '../core/types';
import type { ProfileUpdate } from '../data/people';
import type { Office, Weekday } from '../data/types';
import { isValidDate, isValidTime, isValidTimeZone } from '../lib/zoned';
import { timetableProblems } from './schedule';

export type FormErrors = Record<string, string>;

export type Parsed<T> =
  { ok: true; value: T } | { ok: false; errors: FormErrors; values: Record<string, string> };

/** Every field as the person typed it, to put back into the form with the errors. */
function echo(form: FormData): Record<string, string> {
  const values: Record<string, string> = {};
  for (const [key, value] of form.entries()) {
    if (typeof value !== 'string') continue;
    values[key] = key in values ? `${values[key]},${value}` : value;
  }
  return values;
}

function str(form: FormData, key: string, max = 200): string {
  const value = form.get(key);
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function list(value: string): string[] {
  return value
    .split(/[,;\n]/)
    .map((v) => v.trim())
    .filter(Boolean);
}

export const LANGUAGES: readonly { code: string; name: string }[] = [
  { code: 'en', name: 'English' },
  { code: 'tr', name: 'Türkçe' },
  { code: 'de', name: 'Deutsch' },
  { code: 'fr', name: 'Français' },
  { code: 'es', name: 'Español' },
  { code: 'nl', name: 'Nederlands' },
  { code: 'it', name: 'Italiano' },
  { code: 'pt', name: 'Português' },
  { code: 'pl', name: 'Polski' },
  { code: 'ru', name: 'Русский' },
  { code: 'uk', name: 'Українська' },
  { code: 'ar', name: 'العربية' },
  { code: 'zh', name: '中文' },
  { code: 'ja', name: '日本語' },
  { code: 'hi', name: 'हिन्दी' },
];

export const WEEKDAYS: readonly { day: Weekday; short: string; long: string }[] = [
  { day: 1, short: 'Mon', long: 'Monday' },
  { day: 2, short: 'Tue', long: 'Tuesday' },
  { day: 3, short: 'Wed', long: 'Wednesday' },
  { day: 4, short: 'Thu', long: 'Thursday' },
  { day: 5, short: 'Fri', long: 'Friday' },
  { day: 6, short: 'Sat', long: 'Saturday' },
  { day: 7, short: 'Sun', long: 'Sunday' },
];

export const SENIORITY_LABELS: Record<Seniority, string> = {
  intern: 'Intern',
  junior: 'Junior',
  mid: 'Mid-level',
  senior: 'Senior',
  lead: 'Lead',
  manager: 'Manager',
  director: 'Director or above',
};

/**
 * The office form. Checks every field an admin can get wrong, and the
 * timetable as a whole: tables made after replies close, or replies closing
 * after lunch, are each a day that would silently never work.
 */
export function parseOfficeForm(form: FormData, existingId?: string): Parsed<Office> {
  const errors: FormErrors = {};
  const id = existingId ?? str(form, 'id', 40);
  if (!existingId && !/^[A-Za-z0-9][A-Za-z0-9-]{1,39}$/.test(id)) {
    errors['id'] = 'Letters, digits and dashes, 2 to 40 characters, e.g. IST-HQ.';
  }

  const name = str(form, 'name', 80);
  if (!name) errors['name'] = 'Give the office a name people will recognise.';

  const timeZone = str(form, 'timeZone', 64);
  if (!isValidTimeZone(timeZone)) errors['timeZone'] = 'Pick a time zone from the list.';

  const times = {
    opensAt: str(form, 'opensAt', 5),
    confirmBy: str(form, 'confirmBy', 5),
    reminderAt: str(form, 'reminderAt', 5),
  };
  for (const [key, value] of Object.entries(times)) {
    if (!isValidTime(value)) errors[key] = 'A time like 09:00.';
  }

  const lead = Number(str(form, 'matchLeadMinutes', 4));
  if (!Number.isInteger(lead) || lead < 30 || lead > 720) {
    errors['matchLeadMinutes'] = 'Between half an hour and twelve hours.';
  }

  const slots = [...new Set(list(str(form, 'lunchSlots', 100)))].sort();
  if (slots.length === 0 || slots.length > 6 || !slots.every(isValidTime)) {
    errors['lunchSlots'] = 'One to six times, like 12:00 or 12:00, 13:00.';
  }

  const workingDays = WEEKDAYS.filter((d) => form.get(`day${d.day}`) === 'on').map((d) => d.day);
  if (workingDays.length === 0) errors['workingDays'] = 'Pick at least one working day.';

  const minTable = Number(str(form, 'minTable', 2));
  const maxTable = Number(str(form, 'maxTable', 2));
  if (!Number.isInteger(minTable) || minTable < 2 || minTable > 8) {
    errors['minTable'] = 'From 2 to 8.';
  }
  if (!Number.isInteger(maxTable) || maxTable < minTable || maxTable > 8) {
    errors['maxTable'] = 'At least the smallest table, at most 8.';
  }

  const office: Office = {
    id,
    name,
    address: str(form, 'address', 200),
    meetingPoint: str(form, 'meetingPoint', 200),
    timeZone,
    opensAt: times.opensAt,
    matchLeadMinutes: lead,
    confirmBy: times.confirmBy,
    reminderAt: times.reminderAt,
    lunchSlots: slots,
    workingDays,
    minTable,
    maxTable,
    locationKeywords: list(str(form, 'locationKeywords', 400)).map((k) => k.toLowerCase()),
    active: form.get('active') === 'on',
  };

  if (Object.keys(errors).length === 0) {
    const problems = timetableProblems(office);
    if (problems.length > 0) errors['timetable'] = problems.join(' ');
  }

  return Object.keys(errors).length > 0
    ? { ok: false, errors, values: echo(form) }
    : { ok: true, value: office };
}

export interface ProfileForm extends ProfileUpdate {
  reminders: boolean;
}

/**
 * A first guess at somebody's name from a company address, to save them
 * typing it: "deniz.yeni@" is Deniz Yeni. Only for two or more parts made of
 * letters; "dyeni@" or "d.yeni2@" could be anybody, and guess nothing.
 */
export function nameFromEmail(email: string): string {
  const local = email.split('@')[0] ?? '';
  const parts = local.split(/[._-]+/).filter(Boolean);
  if (parts.length < 2 || !parts.every((p) => /^\p{L}+$/u.test(p))) return '';
  return parts.map((p) => p[0]!.toLocaleUpperCase() + p.slice(1).toLocaleLowerCase()).join(' ');
}

/**
 * What somebody says about themselves. The department comes from the admin's
 * list and the office from the active ones; languages from a known list, since
 * a shared one is a hard rule and "Englsh" would share nothing.
 */
export function parseProfileForm(
  form: FormData,
  context: { departments: readonly string[]; officeIds: readonly string[]; today: string },
): Parsed<ProfileForm> {
  const errors: FormErrors = {};

  const displayName = str(form, 'displayName', 80);
  if (!displayName) errors['displayName'] = 'Your name, as colleagues know it.';

  const department = str(form, 'department', 80);
  if (!context.departments.includes(department)) errors['department'] = 'Pick your department.';

  const seniority = str(form, 'seniority', 20) as Seniority;
  if (!SENIORITY_LADDER.includes(seniority))
    errors['seniority'] = 'Pick the level closest to yours.';

  const officeId = str(form, 'officeId', 40);
  if (!context.officeIds.includes(officeId))
    errors['officeId'] = 'Pick the office you usually work in.';

  const known = new Set(LANGUAGES.map((l) => l.code));
  const languages = form
    .getAll('languages')
    .filter((v): v is string => typeof v === 'string' && known.has(v));
  if (languages.length === 0)
    errors['languages'] = 'At least one language you are happy to have lunch in.';

  let startedOn: string | null = null;
  const started = str(form, 'startedOn', 7);
  if (started) {
    const candidate = `${started}-01`;
    if (!isValidDate(candidate) || candidate > context.today) {
      errors['startedOn'] = 'A month in the past, like 2021-06.';
    } else {
      startedOn = candidate;
    }
  }

  return Object.keys(errors).length > 0
    ? { ok: false, errors, values: echo(form) }
    : {
        ok: true,
        value: {
          displayName,
          title: str(form, 'title', 80),
          department,
          team: str(form, 'team', 60),
          seniority,
          officeId,
          languages: [...new Set(languages)],
          interests: parseInterests(str(form, 'interests', 600)),
          startedOn,
          reminders: form.get('reminders') === 'on',
        },
      };
}

import type { Employee } from '../core/types';
import type { OfficeVenue, SupportedLanguage } from './invite';

export interface ReminderOptions {
  employee: Employee;
  venue: OfficeVenue;
  /** The day being offered, ISO. Already the employee's office day. */
  date: string;
  /** How the date reads to a person, e.g. 'Thursday 17 September'. */
  dayLabel: string;
  /** The page where ticking the box takes one click. */
  optInUrl: string;
  /** Where to turn these off, which has to be in the message itself. */
  settingsUrl: string;
  /** When that morning the tables are made, local, e.g. '06:00'. */
  closesAt: string;
  /** Why this person, of everyone, was asked. */
  because: 'recent' | 'calendar';
  language?: SupportedLanguage;
}

/** One short message to one person, with one thing to do. */
export interface Reminder {
  employee: Employee;
  subject: string;
  text: string;
  html: string;
  actionUrl: string;
  actionLabel: string;
  /** The day being offered, for channels that can take the answer in place. */
  offer?: {
    date: string;
    officeId: string;
    officeName: string;
    dayLabel: string;
    closesAt: string;
  };
}

/**
 * The message that makes the rest of the product happen.
 *
 * Everything else in Sofra waits for someone to have already ticked a box. In a
 * company nobody does that unprompted, so without this the app is a page people
 * visited once. This is the only message that goes to someone who has not asked
 * for anything, which is exactly why it is short, says why it arrived, offers
 * one action, and carries its own way out.
 */
export function buildReminder(options: ReminderOptions): Reminder {
  const { employee, venue, dayLabel, optInUrl, settingsUrl, closesAt, because } = options;
  const lang = options.language ?? pickLanguage(employee.languages);
  const t = STRINGS[lang];

  const text = [
    t.greeting(firstName(employee.displayName)),
    '',
    t.body(dayLabel, venue.displayName, closesAt),
    '',
    t.action(optInUrl),
    '',
    t.noThanks,
    '',
    t.footer(because, settingsUrl),
  ].join('\n');

  return {
    employee,
    subject: t.subject(dayLabel),
    text,
    html: toHtml(text, optInUrl, t.actionLabel),
    actionUrl: optInUrl,
    actionLabel: t.actionLabel,
  };
}

function firstName(displayName: string): string {
  return displayName.split(' ')[0] ?? displayName;
}

function pickLanguage(languages: readonly string[]): SupportedLanguage {
  return languages.includes('tr') && !languages.includes('en') ? 'tr' : 'en';
}

/** A real button, because the whole message exists to get one click. */
function toHtml(text: string, url: string, label: string): string {
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, '<br>');

  return [
    '<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;font-size:15px;line-height:1.55">',
    escaped,
    '<p style="margin:24px 0">',
    `<a href="${url}" style="background:#1f6f4a;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;display:inline-block">${label}</a>`,
    '</p>',
    '</div>',
  ].join('');
}

const STRINGS = {
  en: {
    subject: (day: string) => `Lunch with people you have not met, ${day}`,
    greeting: (name: string) => `Hi ${name},`,
    body: (day: string, office: string, closes: string) =>
      `If you are coming in to ${office} on ${day}, we can put you at a table with two or three people from other teams for lunch. Tables are made at ${closes} that morning, and everybody gets the time and the place straight away.`,
    action: (url: string) => `Count me in: ${url}`,
    actionLabel: 'Count me in',
    noThanks: 'If you would rather not, ignore this. Nothing happens unless you say yes.',
    footer: (because: 'recent' | 'calendar', url: string) =>
      `${because === 'calendar' ? 'You are getting this because your calendar shows you in the office that day.' : 'You are getting this because you have had lunch through Sofra recently.'} Turn these off at ${url}`,
  },
  tr: {
    subject: (day: string) => `${day} tanımadığın kişilerle öğle yemeği`,
    greeting: (name: string) => `Merhaba ${name},`,
    body: (day: string, office: string, closes: string) =>
      `${day} günü ${office} ofisine geleceksen, seni öğle yemeğinde başka ekiplerden iki üç kişiyle aynı masaya oturtalım. Masalar o sabah ${closes}'de kurulur, saat ve yer hemen herkese gider.`,
    action: (url: string) => `Varım: ${url}`,
    actionLabel: 'Varım',
    noThanks: 'İstemiyorsan bu maili yok say. Sen evet demeden hiçbir şey olmaz.',
    footer: (because: 'recent' | 'calendar', url: string) =>
      `${because === 'calendar' ? 'Bu mail, takviminde o gün ofiste göründüğün için geldi.' : 'Bu mail, son zamanlarda Sofra ile öğle yemeğine katıldığın için geldi.'} Kapatmak için: ${url}`,
  },
} as const;

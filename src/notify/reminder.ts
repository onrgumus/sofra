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
  const { employee, venue, dayLabel, optInUrl, settingsUrl } = options;
  const lang = options.language ?? pickLanguage(employee.languages);
  const t = STRINGS[lang];

  const text = [
    t.greeting(firstName(employee.displayName)),
    '',
    t.body(dayLabel, venue.displayName),
    '',
    t.action(optInUrl),
    '',
    t.noThanks,
    '',
    t.footer(settingsUrl),
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
    body: (day: string, office: string) =>
      `You are down to be at ${office} on ${day}. If you want, we will put you at a table with two or three people from other teams for lunch, and send everyone the time and the place the evening before.`,
    action: (url: string) => `Count me in: ${url}`,
    actionLabel: 'Count me in',
    noThanks: 'If you would rather not, ignore this. Nothing happens unless you say yes.',
    footer: (url: string) =>
      `You are getting this because your desk booking says you will be in. Turn these off at ${url}`,
  },
  tr: {
    subject: (day: string) => `${day} tanımadığın kişilerle öğle yemeği`,
    greeting: (name: string) => `Merhaba ${name},`,
    body: (day: string, office: string) =>
      `${day} günü ${office} ofisinde görünüyorsun. İstersen seni başka ekiplerden iki üç kişiyle aynı masaya oturtalım, saat ve yeri bir akşam önce herkese gönderelim.`,
    action: (url: string) => `Varım: ${url}`,
    actionLabel: 'Varım',
    noThanks: 'İstemiyorsan bu maili yok say. Sen evet demeden hiçbir şey olmaz.',
    footer: (url: string) =>
      `Bu mail, masa rezervasyonunda o gün ofiste göründüğün için geldi. Kapatmak için: ${url}`,
  },
} as const;

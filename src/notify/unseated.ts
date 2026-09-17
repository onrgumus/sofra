import type { Employee, UnmatchedReason } from '../core/types';
import type { OfficeVenue, SupportedLanguage } from './invite';
import type { Reminder } from './reminder';

export interface UnseatedOptions {
  employee: Employee;
  venue: OfficeVenue;
  reason: UnmatchedReason;
  /** How the day reads to a person. */
  dayLabel: string;
  /** Where languages can be changed, which fixes one of the two reasons. */
  settingsUrl: string;
  language?: SupportedLanguage;
}

/**
 * The message for somebody who asked and could not be seated.
 *
 * Silence was the worst thing the product did. You tick the box, no table
 * appears, nobody says anything, and the conclusion available to you is that
 * three colleagues were asked and none of them wanted to come. The engine has
 * recorded the real reason since the beginning and only the admin console ever
 * read it.
 *
 * Reuses the reminder's shape because it is the same kind of message: one
 * person, one short thing to say, one way to act on it.
 */
export function buildUnseated(options: UnseatedOptions): Reminder {
  const { employee, dayLabel, settingsUrl } = options;
  const lang = options.language ?? pickLanguage(employee.languages);
  const t = STRINGS[lang];
  const body = options.reason === 'no-common-language' ? t.noLanguage : t.tooFew;

  const text = [
    t.greeting(firstName(employee.displayName)),
    '',
    t.opening(dayLabel),
    '',
    body(settingsUrl),
    '',
    t.footer,
  ].join('\n');

  return {
    employee,
    subject: t.subject(dayLabel),
    text,
    html: toHtml(text),
    actionUrl: settingsUrl,
    actionLabel: t.actionLabel,
  };
}

function firstName(displayName: string): string {
  return displayName.split(' ')[0] ?? displayName;
}

function pickLanguage(languages: readonly string[]): SupportedLanguage {
  return languages.includes('tr') && !languages.includes('en') ? 'tr' : 'en';
}

function toHtml(text: string): string {
  const escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;font-size:15px;line-height:1.55">${escaped.replace(
    /\n/g,
    '<br>',
  )}</div>`;
}

const STRINGS = {
  en: {
    subject: (day: string) => `No lunch table ${day}`,
    greeting: (name: string) => `Hi ${name},`,
    opening: (day: string) => `You asked for a lunch on ${day} and we could not seat you.`,
    tooFew: () =>
      'Too few people asked that day to make a table of three, so there was nowhere to put you rather than anything to do with you. Nothing is needed from you: tick another day whenever you like.',
    noLanguage: (url: string) =>
      `Nobody else asking that day shares a language with you, and a table only works if everyone at it can talk to each other. If you are comfortable in another language, adding it usually fixes this for good: ${url}`,
    actionLabel: 'Your details',
    footer: 'Sent by Sofra, once, about that day. You are not signed up for anything else.',
  },
  tr: {
    subject: (day: string) => `${day} için masa çıkmadı`,
    greeting: (name: string) => `Merhaba ${name},`,
    opening: (day: string) => `${day} günü için yemek istemiştin, seni bir masaya oturtamadık.`,
    tooFew: () =>
      'O gün üç kişilik bir masa kuracak kadar az kişi istedi; yani mesele sen değilsin, oturtacak yer yoktu. Senden bir şey gerekmiyor, istediğin başka bir günü işaretleyebilirsin.',
    noLanguage: (url: string) =>
      `O gün isteyen kimseyle ortak bir dilin yok, ve bir masa ancak herkes birbiriyle konuşabiliyorsa işe yarar. Rahat ettiğin başka bir dil varsa, onu eklemek bunu genelde kalıcı olarak çözer: ${url}`,
    actionLabel: 'Bilgilerin',
    footer:
      'Sofra tarafından, sadece o gün için bir kez gönderildi. Başka hiçbir şeye kayıtlı değilsin.',
  },
} as const;

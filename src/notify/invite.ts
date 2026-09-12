import type { MatchedGroup } from '../core/types.js';
import { buildIcs, type IcsAttendee } from './ics.js';

export interface OfficeVenue {
  officeId: string;
  displayName: string;
  /** IANA zone, e.g. 'Europe/Istanbul'. */
  timeZone: string;
  /** Where to meet, e.g. 'Ground floor cafeteria, by the coffee bar'. */
  meetingPoint: string;
}

export interface InviteOptions {
  group: MatchedGroup;
  venue: OfficeVenue;
  organizer: IcsAttendee;
  durationMinutes?: number;
  /** Page where someone can confirm or drop out before the cut-off. */
  confirmUrl?: string;
  /** Overrides the language picked from the group's shared languages. */
  language?: SupportedLanguage;
}

export interface Invite {
  subject: string;
  text: string;
  html: string;
  ics: string;
  to: IcsAttendee[];
}

export type SupportedLanguage = 'en' | 'tr';

export function buildInvite(options: InviteOptions): Invite {
  const { group, venue, organizer } = options;
  const durationMinutes = options.durationMinutes ?? 60;
  const lang = options.language ?? pickLanguage(group.commonLanguages);
  const t = STRINGS[lang];

  const attendees: IcsAttendee[] = group.members.map((m) => ({
    name: m.displayName,
    email: m.email,
  }));

  const roster = group.members
    .map((m) => `• ${m.displayName} — ${m.title}, ${m.department} (${teamName(m.team)})`)
    .join('\n');
  const icebreakers = buildIcebreakers(group, lang);

  const sections = [
    t.intro(group.members.length, group.slot),
    '',
    t.whereHeading,
    `${venue.displayName} — ${venue.meetingPoint}`,
    '',
    t.whoHeading,
    roster,
    '',
    t.icebreakerHeading,
    icebreakers.map((q) => `• ${q}`).join('\n'),
  ];

  if (group.dietary.length > 0) {
    sections.push('', t.dietaryHeading, group.dietary.join(', '));
  }
  if (options.confirmUrl) {
    sections.push('', t.confirm(options.confirmUrl));
  }
  sections.push('', t.footer);

  const text = sections.join('\n');

  const ics = buildIcs({
    uid: `${group.id}@sofra`,
    date: group.date,
    startTime: group.slot,
    durationMinutes,
    timeZone: venue.timeZone,
    summary: t.subject,
    description: text,
    location: `${venue.displayName} — ${venue.meetingPoint}`,
    organizer,
    attendees,
  });

  return { subject: t.subject, text, html: toHtml(text), ics, to: attendees };
}

/**
 * The invite is written in a language everyone at the table speaks. If the group
 * shares several, the first one wins; the matcher already guarantees at least one.
 */
function pickLanguage(commonLanguages: readonly string[]): SupportedLanguage {
  for (const lang of commonLanguages) {
    if (lang === 'tr' || lang === 'en') return lang;
  }
  return 'en';
}

/**
 * Openers derived from the table itself, so they are never generic small talk.
 * A shared interest goes first, then the widest gap in the room, then a default.
 */
export function buildIcebreakers(group: MatchedGroup, lang: SupportedLanguage): string[] {
  const t = STRINGS[lang];
  const questions: string[] = [];

  const shared = sharedInterest(group);
  if (shared) questions.push(t.icebreakerShared(shared));

  const departments = [...new Set(group.members.map((m) => m.department))];
  if (departments.length > 1) questions.push(t.icebreakerDepartments(departments));

  const newest = [...group.members].sort((a, b) => a.tenureMonths - b.tenureMonths)[0];
  const longest = [...group.members].sort((a, b) => b.tenureMonths - a.tenureMonths)[0];
  if (newest && longest && longest.tenureMonths - newest.tenureMonths >= 24) {
    questions.push(t.icebreakerTenure(longest.displayName, newest.displayName));
  }

  questions.push(...t.icebreakerDefaults);
  return questions.slice(0, 3);
}

/** Teams are stored as 'Department/Team'; the invite only needs the second half. */
function teamName(team: string): string {
  const slash = team.lastIndexOf('/');
  return slash === -1 ? team : team.slice(slash + 1);
}

function sharedInterest(group: MatchedGroup): string | null {
  const [first, ...rest] = group.members;
  if (!first) return null;
  return first.interests.find((i) => rest.every((m) => m.interests.includes(i))) ?? null;
}

function toHtml(text: string): string {
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return `<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;font-size:15px;line-height:1.55">${escaped.replace(
    /\n/g,
    '<br>',
  )}</div>`;
}

const STRINGS = {
  en: {
    subject: 'Lunch with three people you have not met',
    intro: (count: number, slot: string) =>
      `You are one of ${count} people having lunch together at ${slot} today. You work at the same company and, as far as we can tell, you have never had lunch together.`,
    whereHeading: 'Where',
    whoHeading: 'Who',
    icebreakerHeading: 'If the conversation stalls',
    dietaryHeading: 'Dietary needs at this table',
    confirm: (url: string) => `Cannot make it? Let us know by 10:00 so we can reseat the table: ${url}`,
    footer: 'Sent by Sofra. You opted in for this slot; you can opt out any time.',
    icebreakerShared: (interest: string) => `You all put "${interest}" on your profile. Start there.`,
    icebreakerDepartments: (departments: string[]) =>
      `${departments.join(', ')} are at this table. What does each of you think the others actually do all day?`,
    icebreakerTenure: (longest: string, newest: string) =>
      `${longest} has been here far longer than ${newest}. What has changed the most?`,
    icebreakerDefaults: [
      'What is one thing your team is working on that nobody outside it knows about?',
      'What is the best decision your team made this year, and the worst?',
    ],
  },
  tr: {
    subject: 'Bugün öğle yemeği: hiç tanışmadığın üç kişi',
    intro: (count: number, slot: string) =>
      `Bugün saat ${slot}'de birlikte yemek yiyecek ${count} kişiden birisin. Aynı şirkette çalışıyorsunuz ve bildiğimiz kadarıyla daha önce hiç birlikte yemek yemediniz.`,
    whereHeading: 'Nerede',
    whoHeading: 'Kimler',
    icebreakerHeading: 'Sohbet tıkanırsa',
    dietaryHeading: 'Bu masadaki beslenme tercihleri',
    confirm: (url: string) =>
      `Gelemiyor musun? Masayı yeniden kurabilmemiz için 10:00'a kadar haber ver: ${url}`,
    footer: 'Sofra tarafından gönderildi. Bu slot için sen katılmayı seçtin; istediğin an çıkabilirsin.',
    icebreakerShared: (interest: string) =>
      `Hepiniz profilinize "${interest}" yazmışsınız. Oradan başlayın.`,
    icebreakerDepartments: (departments: string[]) =>
      `Bu masada ${departments.join(', ')} var. Her biriniz diğerlerinin gün boyu ne yaptığını sanıyor?`,
    icebreakerTenure: (longest: string, newest: string) =>
      `${longest}, ${newest}'den çok daha uzun süredir burada. En çok ne değişti?`,
    icebreakerDefaults: [
      'Ekibinin üzerinde çalıştığı, dışarıdan kimsenin bilmediği bir şey ne?',
      'Ekibinin bu yıl aldığı en iyi karar hangisiydi, en kötüsü hangisi?',
    ],
  },
} as const;

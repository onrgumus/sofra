import type { MatchedGroup } from '../core/types';
import { buildIcs, type IcsAttendee } from './ics';

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
  /** The conversation topic chosen for this table, exposed for the admin view. */
  topic: string;
}

export type SupportedLanguage = 'en' | 'tr';

/**
 * One mail addressed to the whole table, not four separate notes.
 *
 * The difference matters: everyone sees the same names at the same moment, can
 * reply to each other before lunch, and nobody has to wonder whether the others
 * actually got it.
 */
export function buildInvite(options: InviteOptions): Invite {
  const { group, venue, organizer } = options;
  const durationMinutes = options.durationMinutes ?? 60;
  const lang = options.language ?? pickLanguage(group.commonLanguages);
  const t = STRINGS[lang];
  const topic = pickTopic(group.id, lang);
  const subject = t.subject(group.members.length);

  const attendees: IcsAttendee[] = group.members.map((m) => ({
    name: m.displayName,
    email: m.email,
  }));

  const roster = group.members
    .map((m) => `• ${m.displayName} — ${m.title}, ${m.department} (${teamName(m.team)})`)
    .join('\n');

  const sections = [
    t.intro(group.members.length, group.slot),
    '',
    t.whereHeading,
    `${venue.displayName} — ${venue.meetingPoint}`,
    '',
    t.whoHeading,
    roster,
    '',
    t.startHeading,
    t.startBody,
    '',
    t.topicHeading,
    topic,
    '',
    t.icebreakerHeading,
    buildIcebreakers(group, lang)
      .map((q) => `• ${q}`)
      .join('\n'),
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
    summary: subject,
    description: text,
    location: `${venue.displayName} — ${venue.meetingPoint}`,
    organizer,
    attendees,
  });

  return { subject, text, html: toHtml(text), ics, to: attendees, topic };
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
 * A topic per table, stable for a given group so re-sending an invite does not
 * change what people prepared for, and varied across tables so the same four
 * departments are not all having the same conversation.
 */
export function pickTopic(groupId: string, lang: SupportedLanguage): string {
  const topics = STRINGS[lang].topics;
  let hash = 0;
  for (let i = 0; i < groupId.length; i++) hash = (hash * 31 + groupId.charCodeAt(i)) >>> 0;
  return topics[hash % topics.length]!;
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
  const escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;font-size:15px;line-height:1.55">${escaped.replace(
    /\n/g,
    '<br>',
  )}</div>`;
}

/** Tables are three or four, so the subject line can say so in words. */
const EN_NUMBERS: Record<number, string> = { 3: 'three', 4: 'four', 5: 'five' };
const TR_TOGETHER: Record<number, string> = { 3: 'üçünüz', 4: 'dördünüz', 5: 'beşiniz' };

const STRINGS = {
  en: {
    subject: (count: number) => `Lunch today at 12:00 — the ${EN_NUMBERS[count] ?? count} of you`,
    intro: (count: number, slot: string) =>
      `The ${count} of you are having lunch together at ${slot} today. You work at the same company, you are all in the building, and none of you have had lunch together before. This mail went to all ${count} of you at once, so just reply here to sort out where you are going.`,
    whereHeading: 'Where',
    whoHeading: 'Who',
    startHeading: 'How to start',
    startBody:
      'Go round the table before you order. Name, which team you are on, what you actually work on day to day, and what you were doing before you got here. That last one is usually where the interesting part is.',
    topicHeading: "Today's topic",
    icebreakerHeading: 'If the conversation stalls',
    dietaryHeading: 'Dietary needs at this table',
    confirm: (url: string) =>
      `Cannot make it? Let us know by 10:00 so we can reseat the table: ${url}`,
    footer: 'Sent by Sofra. You asked for this one day; you are not signed up for anything else.',
    icebreakerShared: (interest: string) => `You all put "${interest}" on your profile. Start there.`,
    icebreakerDepartments: (departments: string[]) =>
      `${departments.join(', ')} are at this table. What does each of you think the others actually do all day?`,
    icebreakerTenure: (longest: string, newest: string) =>
      `${longest} has been here far longer than ${newest}. What has changed the most?`,
    icebreakerDefaults: [
      'What is one thing your team is working on that nobody outside it knows about?',
      'What is the best decision your team made this year, and the worst?',
    ],
    topics: [
      'What your team is actually measured on — and whether that is the right thing to measure.',
      'The one process at this company you would delete tomorrow if it were up to you.',
      'What you worked on before this job, and what it taught you that still holds.',
      'What other teams consistently misunderstand about yours.',
      'A decision your team got right this year, and one it got wrong.',
      'The tool or habit you could not do your job without.',
      'What you would work on here if nobody assigned you anything for a month.',
      'The part of your job that would surprise someone outside your department.',
    ],
  },
  tr: {
    subject: (count: number) => `Bugün 12:00 öğle yemeği — ${TR_TOGETHER[count] ?? `${count} kişi`}`,
    intro: (count: number, slot: string) =>
      `Bugün saat ${slot}'de ${count} kişi birlikte yemek yiyeceksiniz. Aynı şirkette çalışıyorsunuz, hepiniz bugün ofistesiniz ve daha önce hiç birlikte yemek yemediniz. Bu mail ${count}'inize aynı anda gitti; nereye gideceğinizi buradan yanıtlayarak kararlaştırabilirsiniz.`,
    whereHeading: 'Nerede',
    whoHeading: 'Kimler',
    startHeading: 'Nasıl başlanır',
    startBody:
      'Sipariş vermeden önce masayı bir tur dolaşın. Adınız, hangi ekipte olduğunuz, gün içinde gerçekte ne yaptığınız ve buraya gelmeden önce nerede çalıştığınız. İşin ilginç kısmı genelde bu sonuncusunda çıkar.',
    topicHeading: 'Bugünün konusu',
    icebreakerHeading: 'Sohbet tıkanırsa',
    dietaryHeading: 'Bu masadaki beslenme tercihleri',
    confirm: (url: string) =>
      `Gelemiyor musun? Masayı yeniden kurabilmemiz için 10:00'a kadar haber ver: ${url}`,
    footer:
      'Sofra tarafından gönderildi. Sadece bu gün için katılmayı seçtin; başka hiçbir şeye kaydolmadın.',
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
    topics: [
      'Ekibin gerçekte neye göre ölçülüyor — ve ölçülmesi gereken şey bu mu?',
      'Sana kalsa yarın kaldıracağın tek şirket içi süreç hangisi?',
      'Bu işten önce ne yapıyordun ve oradan öğrenip hâlâ kullandığın şey ne?',
      'Diğer ekipler seninkiyle ilgili sürekli neyi yanlış anlıyor?',
      'Ekibinin bu yıl doğru yaptığı bir karar ve yanlış yaptığı bir karar.',
      'Onsuz işini yapamayacağın araç ya da alışkanlık hangisi?',
      'Bir ay boyunca kimse sana iş vermese burada neyin üzerinde çalışırdın?',
      'İşinin, departmanın dışındaki birini en çok şaşırtacak kısmı hangisi?',
    ],
  },
} as const;

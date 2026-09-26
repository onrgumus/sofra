/**
 * How dates read to a person. Everything about *which* day it is where an
 * office is lives in `zoned.ts`; this is only the wording.
 */

/**
 * The long form, for a message that has to say which day it means.
 *
 * The invite goes out the evening before, so "today" in it was a lie to every
 * recipient. Naming the day is the only form that is true whenever it is sent,
 * and it has to be true in the language the invite is written in.
 */
export function formatDayLong(isoDate: string, locale = 'en-GB'): string {
  return new Date(`${isoDate}T00:00:00Z`).toLocaleDateString(locale, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  });
}

export function formatDay(isoDate: string, locale = 'en-GB'): string {
  return new Date(`${isoDate}T00:00:00Z`).toLocaleDateString(locale, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
}

/**
 * A length of service the way somebody would say it out loud.
 *
 * The directory counts months because that is what arithmetic wants. "101
 * months" is not something a person has ever said about their own job, and it
 * was on the page where somebody checks what the company holds about them.
 */
export function formatTenure(months: number): string {
  if (months < 1) return 'less than a month';
  if (months < 18) return months === 1 ? '1 month' : `${months} months`;

  const years = Math.floor(months / 12);
  const rest = months % 12;
  const yearPart = years === 1 ? '1 year' : `${years} years`;
  if (rest === 0) return yearPart;

  return `${yearPart}, ${rest === 1 ? '1 month' : `${rest} months`}`;
}

import type { Employee } from './types';

/**
 * The part of a person's record that only they can know.
 *
 * Everything else about an employee belongs to the company directory: name,
 * role, department, office, how long they have been here. Two fields do not,
 * and no HR system holds them. Nobody's Workday record says they speak Turkish
 * and English, or that they climb at weekends.
 *
 * Both drive the matching. A shared language is a hard rule, so a wrong one
 * seats somebody at a table where they cannot talk. A shared interest is the
 * opener the invite leads with. Leaving them to a directory export meant they
 * were either invented, in the demo, or empty, in a real company.
 */
export interface EmployeeProfile {
  employeeId: string;
  /** ISO 639-1 codes. At least one, or the person cannot be seated at all. */
  languages: string[];
  interests: string[];
  updatedAt: string;
}

/**
 * The directory record with whatever the person has said about themselves.
 *
 * An absent profile is not an empty one: somebody who has never opened the page
 * keeps what the directory gave them, which is how a company that does export
 * languages gets sensible matching on day one.
 */
export function withProfile(employee: Employee, profile: EmployeeProfile | null): Employee {
  if (!profile) return employee;

  return {
    ...employee,
    languages: profile.languages.length > 0 ? profile.languages : employee.languages,
    interests: profile.interests,
  };
}

/** An id in another system, learned at runtime rather than exported. */
export interface EmployeeLink {
  employeeId: string;
  system: string;
  value: string;
}

/**
 * The directory record with the ids Sofra has learned since it was written.
 *
 * Somebody signs in through Teams and the token carries their Entra object id.
 * Recording it means the next sign-in is an exact match rather than a guess,
 * and that it keeps working after HR changes their address, which is the whole
 * reason to prefer an id over an address in the first place.
 */
export function withLinks(employee: Employee, links: Record<string, string>): Employee {
  if (Object.keys(links).length === 0) return employee;

  // What we learned wins. A token is signed by the identity provider and was
  // verified at an actual sign-in; an export is a periodic dump that can be
  // stale or simply wrong. Getting this backwards meant the learned id was
  // stored and then never used, so the mechanism silently did nothing for
  // exactly the companies whose exports are wrong, and the sign-in rewrote the
  // same row on every visit because the overlay never reflected it.
  return { ...employee, externalIds: { ...employee.externalIds, ...links } };
}

/** How many interests are worth keeping, and how long one may be. */
export const MAX_INTERESTS = 12;
export const MAX_INTEREST_LENGTH = 40;

/**
 * Cleans up what somebody typed into a comma-separated box.
 *
 * Lowercased because matching compares them literally, so "Chess" and "chess"
 * being different would quietly cost people the thing the field is for.
 */
export function parseInterests(input: string): string[] {
  const seen = new Set<string>();

  for (const raw of input.split(/[,;\n]/)) {
    const interest = raw.trim().toLowerCase().replace(/\s+/g, ' ').slice(0, MAX_INTEREST_LENGTH);
    if (interest !== '') seen.add(interest);
    if (seen.size >= MAX_INTERESTS) break;
  }
  return [...seen];
}

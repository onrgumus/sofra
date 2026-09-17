/**
 * Core domain types.
 *
 * Design note: nothing here knows about a desk-booking vendor, a database, or an
 * email provider. The matcher is a pure function over these types, which is what
 * makes it testable and portable across companies.
 */

/** Ordered so "distance" between two levels is meaningful. */
export const SENIORITY_LADDER = [
  'intern',
  'junior',
  'mid',
  'senior',
  'lead',
  'manager',
  'director',
] as const;

export type Seniority = (typeof SENIORITY_LADDER)[number];

export interface Employee {
  id: string;
  displayName: string;
  email: string;
  /** Free-text job title, shown in the invite. */
  title: string;
  seniority: Seniority;
  department: string;
  /** Immediate team. Two people from the same team are the thing we avoid. */
  team: string;
  officeId: string;
  /** ISO 639-1 codes. A group needs at least one language everyone shares. */
  languages: string[];
  tenureMonths: number;
  interests: string[];
  /**
   * Other addresses that mean this person: a user principal name that is not
   * the mail address, a proxy address, the one they use in Slack. Entra tenants
   * where UPN and mail differ are the common case, not the exception, so
   * without these a large share of a company cannot sign in through Teams.
   */
  aliases?: string[];
  /**
   * Ids in other systems, e.g. `{ entra: '<object id>', slack: 'U01ABC' }`.
   * Preferred over any address when resolving who somebody is, because an id
   * survives a name change and an address does not.
   */
  externalIds?: Record<string, string>;
}

/**
 * One person saying "today I want to eat with people from other teams".
 *
 * Being in the office is not this. Plenty of days you go in to sit with your own
 * team and get work done, and that is fine. Sofra leaves you alone unless you
 * raise your hand for a specific day.
 */
export interface OptIn {
  employeeId: string;
  /** ISO date, e.g. '2026-09-16'. */
  date: string;
  officeId: string;
  /** Local time, e.g. '12:00'. */
  slot: string;
}

/** One past lunch, used to avoid re-matching the same people too soon. */
export interface PastMatch {
  /** ISO date the lunch happened. */
  date: string;
  memberIds: string[];
}

export interface MatchWeights {
  department: number;
  seniority: number;
  tenure: number;
  interests: number;
  novelty: number;
}

export interface MatchConfig {
  /** Preferred group size. Everything else bends around this. */
  groupSize: number;
  minGroupSize: number;
  maxGroupSize: number;
  /** Days before two people may be matched with each other again. */
  repeatCooldownDays: number;
  weights: MatchWeights;
  /** 2-opt swap passes. A few hundred is plenty for pools under ~500. */
  localSearchIterations: number;
  /** Fixed seed keeps runs reproducible, which makes results reviewable. */
  seed: number;
}

export const DEFAULT_CONFIG: MatchConfig = {
  groupSize: 4,
  minGroupSize: 3,
  maxGroupSize: 4,
  repeatCooldownDays: 60,
  weights: {
    department: 1.0,
    seniority: 1.0,
    tenure: 0.4,
    interests: 0.6,
    novelty: 0.8,
  },
  localSearchIterations: 400,
  seed: 42,
};

/**
 * How far we had to bend the rules to seat everyone. We always seat everyone;
 * "no match found for you" is the one message that kills this product.
 */
export type Relaxation = 'none' | 'allow-repeat' | 'allow-same-team';

export interface MatchedGroup {
  id: string;
  date: string;
  officeId: string;
  slot: string;
  members: Employee[];
  score: number;
  relaxation: Relaxation;
  /** Languages every member speaks. The invite is written in the first one. */
  commonLanguages: string[];
}

/**
 * Why someone could not be seated. Both are rare, and both now produce an
 * honest, non-rejecting message rather than silence: see `notify/unseated`.
 * For a long time this reason was recorded and only the admin console read it,
 * which left the person to conclude that three colleagues had been asked and
 * none of them wanted to come.
 */
export type UnmatchedReason = 'pool-too-small' | 'no-common-language';

export interface Unmatched {
  employee: Employee;
  reason: UnmatchedReason;
}

export interface MatchResult {
  date: string;
  officeId: string;
  slot: string;
  groups: MatchedGroup[];
  unmatched: Unmatched[];
  totalScore: number;
}

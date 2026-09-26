import type { Seniority } from '../core/types';

/** ISO weekday: 1 is Monday, 7 is Sunday. */
export type Weekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export interface Office {
  id: string;
  name: string;
  address: string;
  /** Where a table meets, e.g. "Ground floor cafeteria, by the coffee bar". */
  meetingPoint: string;
  /** IANA zone, e.g. 'Europe/Istanbul'. Every time below is local to it. */
  timeZone: string;
  /** When the working day starts, 'HH:MM'. Matching is timed from this. */
  opensAt: string;
  /** How long before opening the tables are made. */
  matchLeadMinutes: number;
  /** Replies after this, on the day, no longer reseat anybody. 'HH:MM'. */
  confirmBy: string;
  /** When the evening-before reminder goes out, 'HH:MM'. */
  reminderAt: string;
  /** Lunch times, 'HH:MM', earliest first. The first is the default. */
  lunchSlots: string[];
  workingDays: Weekday[];
  minTable: number;
  maxTable: number;
  /** Words that, found in somebody's Entra office location, mean this office. */
  locationKeywords: string[];
  active: boolean;
}

export interface Holiday {
  officeId: string;
  date: string;
  name: string;
}

export type EmployeeSource = 'self' | 'entra' | 'csv' | 'seed';

/**
 * A person as stored. Unlike the matcher's `Employee`, any of what matching
 * needs may still be missing: somebody who has signed in once and not yet said
 * which office they work in is a person, not yet a candidate for a table.
 */
export interface Person {
  id: string;
  email: string;
  displayName: string;
  title: string;
  department: string | null;
  team: string;
  seniority: Seniority | null;
  officeId: string | null;
  languages: string[];
  interests: string[];
  startedOn: string | null;
  aliases: string[];
  entraObjectId: string | null;
  slackUserId: string | null;
  source: EmployeeSource;
  active: boolean;
  onboardedAt: string | null;
  reminders: boolean;
  createdAt: string;
  lastSeenAt: string | null;
}

export type SignInMethod = 'email' | 'oidc' | 'teams';

export interface Session {
  employeeId: string;
  method: SignInMethod;
  createdAt: string;
  authenticatedAt: string;
  lastSeenAt: string;
  expiresAt: string;
  userAgent: string;
  ip: string;
  /** The hash, which identifies the row without being the secret. */
  idHash: string;
}

export interface AdminGrant {
  id: number;
  employeeId: string;
  /** Null means every office. */
  officeId: string | null;
  grantedBy: string;
  grantedAt: string;
}

export type RequestSource = 'manual' | 'weekly' | 'teams';

export interface LunchRequest {
  employeeId: string;
  date: string;
  officeId: string;
  /** Null: any of the office's lunch times. */
  slot: string | null;
  source: RequestSource;
}

export interface WeeklyPattern {
  employeeId: string;
  weekdays: Weekday[];
  slot: string | null;
}

export type RsvpStatus = 'pending' | 'accepted' | 'declined';

export type JobKind = 'match' | 'reminder' | 'directory-sync';
export type JobStatus = 'running' | 'done' | 'failed' | 'skipped';

export interface JobRun {
  id: number;
  kind: JobKind;
  officeId: string | null;
  runKey: string;
  trigger: 'schedule' | 'manual';
  status: JobStatus;
  attempts: number;
  startedAt: string;
  finishedAt: string | null;
  summary: Record<string, unknown>;
  error: string | null;
}

export interface AuditEntry {
  id: number;
  at: string;
  actorId: string | null;
  actorEmail: string;
  action: string;
  target: string;
  details: Record<string, unknown>;
}

export interface OutboxMail {
  id: number;
  createdAt: string;
  sender: string;
  recipients: string[];
  subject: string;
  text: string;
  html: string;
  attachments: { filename: string; content: string; contentType: string }[];
}

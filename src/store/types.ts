import type { EmployeeProfile } from '../core/profile';
import type {
  Employee,
  MatchResult,
  MatchedGroup,
  OptIn,
  PastMatch,
  Unmatched,
} from '../core/types';

export type RsvpStatus = 'pending' | 'accepted' | 'declined';

export interface Office {
  id: string;
  displayName: string;
  /** IANA zone, used for the calendar invite. */
  timeZone: string;
  meetingPoint: string;
}

export interface StoredGroup extends MatchedGroup {
  rsvps: Record<string, RsvpStatus>;
  /** Null once the table has changed and the new invite has not gone out yet. */
  invitesSentAt: string | null;
  /**
   * When the cancellation went out. A cancelled table whose invite was already
   * sent leaves a stale entry in four calendars until this happens.
   */
  cancellationSentAt: string | null;
  /** Set when too many people dropped out to keep the table worth having. */
  cancelled: boolean;
  /**
   * Bumped whenever the membership changes. Goes into the calendar invite's
   * SEQUENCE, which is how every calendar client knows to update an existing
   * event instead of adding a second one.
   */
  sequence: number;
}

/** Where we learned someone would be in the office. */
export type AttendanceSource = 'desk-booking' | 'self-declared';

/** Who was given the console, by whom, and when. */
export interface AdminGrant {
  employeeId: string;
  grantedBy: string;
  grantedAt: string;
}

export interface DayStatus {
  date: string;
  officeId: string;
  attending: boolean;
  source: AttendanceSource | null;
  optIn: OptIn | null;
  group: StoredGroup | null;
}

/**
 * Everything the app needs to persist.
 *
 * Every method is async, including the ones an in-memory implementation could
 * answer instantly. That is not ceremony: a database cannot do I/O
 * synchronously, so a synchronous signature here would mean no implementation
 * but the in-memory one could ever exist. The cost is a few `await`s; the
 * alternative is discovering on the first real deployment that the interface
 * was shaped around the demo.
 */
export interface Store {
  listOffices(): Promise<Office[]>;
  getOffice(officeId: string): Promise<Office | undefined>;

  /** Directory records with each person's own languages and interests applied. */
  listEmployees(officeId?: string): Promise<Employee[]>;
  getEmployee(employeeId: string): Promise<Employee | undefined>;

  /**
   * What somebody has said about themselves, as they said it.
   *
   * Separate from `getEmployee` because the edit form has to show what is
   * actually stored rather than the directory's fallback, or saving the page
   * unchanged would silently turn a fallback into a choice.
   */
  getProfile(employeeId: string): Promise<EmployeeProfile | null>;
  setProfile(profile: EmployeeProfile): Promise<void>;

  /** Runs the composite attendance provider for that day. */
  getAttendance(date: string, officeId: string): Promise<string[]>;
  attendanceSource(
    employeeId: string,
    date: string,
    officeId: string,
  ): Promise<AttendanceSource | null>;
  setSelfDeclaredAttendance(
    employeeId: string,
    date: string,
    officeId: string,
    attending: boolean,
  ): Promise<void>;

  listOptIns(date: string, officeId: string): Promise<OptIn[]>;
  getOptIn(employeeId: string, date: string, officeId: string): Promise<OptIn | null>;
  setOptIn(optIn: OptIn): Promise<void>;
  removeOptIn(employeeId: string, date: string, officeId: string): Promise<void>;

  listGroups(date: string, officeId: string): Promise<StoredGroup[]>;
  getGroup(groupId: string): Promise<StoredGroup | null>;
  groupForEmployee(employeeId: string, date: string, officeId: string): Promise<StoredGroup | null>;
  saveMatchResult(result: MatchResult): Promise<void>;
  /** Anyone the engine could not seat, so the admin sees it rather than guessing. */
  listUnmatched(date: string, officeId: string): Promise<Unmatched[]>;
  clearGroups(date: string, officeId: string): Promise<void>;
  markInviteSent(groupId: string): Promise<void>;
  markCancellationSent(groupId: string): Promise<void>;
  /**
   * Records a reply and, when a decline leaves the table too small, moves the
   * people still coming to other tables that have room.
   */
  setRsvp(groupId: string, employeeId: string, status: RsvpStatus): Promise<void>;

  listPastMatches(): Promise<PastMatch[]>;

  /**
   * Who may open the matching console, beyond the bootstrap list in the
   * environment. Rows rather than configuration, so granting somebody the
   * console does not mean redeploying the application.
   */
  listAdmins(): Promise<AdminGrant[]>;
  grantAdmin(grant: AdminGrant): Promise<void>;
  revokeAdmin(employeeId: string): Promise<void>;

  /**
   * Who has already been sent a given message about a given day.
   *
   * Without this the reminder is a liability: a cron that retries, or a second
   * schedule somebody added, mails the whole building twice about the same
   * lunch. Recorded only after a send succeeds, so a failure is retried rather
   * than counted as delivered.
   */
  listNotified(kind: string, date: string, officeId: string): Promise<string[]>;
  recordNotified(
    kind: string,
    date: string,
    officeId: string,
    employeeIds: readonly string[],
  ): Promise<void>;

  /**
   * People who have asked not to be reminded. An opt-out has to exist and has
   * to be honoured everywhere, or the reminder is spam with extra steps.
   */
  listRemindersOff(): Promise<string[]>;
  setReminders(employeeId: string, enabled: boolean): Promise<void>;

  /**
   * Failed sign-in attempts, so a password can be rate limited.
   *
   * In the store because it is the only state shared between instances. A
   * counter in memory would reset on every cold start and be per-instance
   * besides, which on a serverless platform is barely a speed bump.
   */
  recordSignInFailure(key: string, atIso: string): Promise<void>;
  countSignInFailures(key: string, sinceIso: string): Promise<number>;
  clearSignInFailures(key: string): Promise<void>;
}

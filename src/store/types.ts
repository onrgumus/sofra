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

  listEmployees(officeId?: string): Promise<Employee[]>;
  getEmployee(employeeId: string): Promise<Employee | undefined>;

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
}

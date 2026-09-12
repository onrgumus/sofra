import type { Employee, MatchResult, MatchedGroup, OptIn, PastMatch, Unmatched } from '../core/types';

export type RsvpStatus = 'pending' | 'accepted' | 'declined';

export interface Office {
  id: string;
  displayName: string;
  /** IANA zone, used for the calendar invite. */
  timeZone: string;
  meetingPoint: string;
  locale: string;
}

export interface StoredGroup extends MatchedGroup {
  rsvps: Record<string, RsvpStatus>;
  invitesSentAt: string | null;
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
 * Everything the app needs to persist. The demo implementation keeps it in
 * memory; a Postgres one implements the same surface without the rest of the app
 * noticing.
 */
export interface Store {
  listOffices(): Office[];
  getOffice(officeId: string): Office | undefined;

  listEmployees(officeId?: string): Employee[];
  getEmployee(employeeId: string): Employee | undefined;

  /** Runs the composite attendance provider for that day. */
  getAttendance(date: string, officeId: string): Promise<string[]>;
  attendanceSource(employeeId: string, date: string, officeId: string): Promise<AttendanceSource | null>;
  setSelfDeclaredAttendance(employeeId: string, date: string, officeId: string, attending: boolean): void;

  listOptIns(date: string, officeId: string): OptIn[];
  getOptIn(employeeId: string, date: string, officeId: string): OptIn | null;
  setOptIn(optIn: OptIn): void;
  removeOptIn(employeeId: string, date: string, officeId: string): void;

  listGroups(date: string, officeId: string): StoredGroup[];
  getGroup(groupId: string): StoredGroup | null;
  groupForEmployee(employeeId: string, date: string, officeId: string): StoredGroup | null;
  saveMatchResult(result: MatchResult): void;
  /** Anyone the engine could not seat, so the admin sees it rather than guessing. */
  listUnmatched(date: string, officeId: string): Unmatched[];
  clearGroups(date: string, officeId: string): void;
  markInvitesSent(date: string, officeId: string): void;
  /**
   * Records a reply and, when a decline leaves the table too small, moves the
   * people still coming to other tables that have room. Returns the group each
   * moved person ended up at, so the caller can tell them.
   */
  setRsvp(groupId: string, employeeId: string, status: RsvpStatus): void;

  listPastMatches(): PastMatch[];

  /** Demo affordance: the app has no auth, so "who am I" is switchable. */
  getCurrentEmployeeId(): string;
  setCurrentEmployeeId(employeeId: string): void;
}

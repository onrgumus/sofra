import { matchLunches } from '../core/matcher';
import { createRng } from '../core/rng';
import type { Employee, MatchResult, OptIn, PastMatch, Unmatched } from '../core/types';
import { generateCompany } from '../sim/company';
import { CompositeAttendanceProvider } from '../providers/composite';
import { ManualAttendanceProvider } from '../providers/manual';
import { WebhookAttendanceProvider } from '../providers/webhook';
import type { AttendanceRecord } from '../providers/types';
import { pastWeekdays, upcomingWeekdays } from '../lib/dates';
import type { AttendanceSource, Office, RsvpStatus, Store, StoredGroup } from './types';

export const SLOT = '12:00';

const OFFICES: Office[] = [
  {
    id: 'IST-HQ',
    displayName: 'Istanbul HQ',
    timeZone: 'Europe/Istanbul',
    meetingPoint: 'Ground floor cafeteria, by the coffee bar',
    locale: 'tr-TR',
  },
  {
    id: 'AMS-1',
    displayName: 'Amsterdam Zuidas',
    timeZone: 'Europe/Amsterdam',
    meetingPoint: '2nd floor kitchen, next to the big window',
    locale: 'en-GB',
  },
];

const OFFICE_LANGUAGES: Record<string, string[]> = {
  'IST-HQ': ['en', 'tr'],
  'AMS-1': ['en', 'nl'],
};

function key(...parts: string[]): string {
  return parts.join('|');
}

/**
 * In-memory store, seeded with a synthetic company so the app is reviewable
 * without a database, a desk-booking vendor, or anyone's real HR data.
 *
 * The seeded office attendance arrives through WebhookAttendanceProvider, which
 * is exactly the shape a desk-booking tool pushing to us would take — so the demo
 * exercises the real provider classes rather than faking around them.
 */
export class DemoStore implements Store {
  private readonly employees: Employee[];
  private readonly employeeById: Map<string, Employee>;

  private readonly deskFeed = new WebhookAttendanceProvider();
  private selfDeclared: AttendanceRecord[] = [];
  /** "I know the desk tool says I'm in, but plans changed." */
  private readonly suppressed = new Set<string>();

  private readonly optIns = new Map<string, OptIn>();
  private readonly groups = new Map<string, StoredGroup>();
  private readonly seededHistory: PastMatch[] = [];
  private readonly unmatched = new Map<string, Unmatched[]>();

  private currentEmployeeId: string;

  constructor(seed = 7, size = 240) {
    this.employees = generateCompany({
      size,
      offices: OFFICES.map((o) => o.id),
      seed,
      officeLanguages: OFFICE_LANGUAGES,
    });
    this.employeeById = new Map(this.employees.map((e) => [e.id, e]));
    this.currentEmployeeId = this.employees.find((e) => e.officeId === 'IST-HQ')!.id;

    this.seedDeskBookings(seed);
    this.seedHistory(seed);
    this.seedOptIns(seed);
  }

  // --- reference data -------------------------------------------------------

  listOffices(): Office[] {
    return OFFICES;
  }

  getOffice(officeId: string): Office | undefined {
    return OFFICES.find((o) => o.id === officeId);
  }

  listEmployees(officeId?: string): Employee[] {
    return officeId ? this.employees.filter((e) => e.officeId === officeId) : this.employees;
  }

  getEmployee(employeeId: string): Employee | undefined {
    return this.employeeById.get(employeeId);
  }

  // --- attendance -----------------------------------------------------------

  private provider(): CompositeAttendanceProvider {
    return new CompositeAttendanceProvider([
      this.deskFeed,
      new ManualAttendanceProvider(this.selfDeclared),
    ]);
  }

  async getAttendance(date: string, officeId: string): Promise<string[]> {
    const records = await this.provider().getAttendance({ date, officeId });
    return records
      .map((r) => r.employeeId)
      .filter((employeeId) => !this.suppressed.has(key(employeeId, date, officeId)));
  }

  async attendanceSource(
    employeeId: string,
    date: string,
    officeId: string,
  ): Promise<AttendanceSource | null> {
    if (this.suppressed.has(key(employeeId, date, officeId))) return null;

    const fromDesk = await this.deskFeed.getAttendance({ date, officeId });
    if (fromDesk.some((r) => r.employeeId === employeeId)) return 'desk-booking';

    const declared = this.selfDeclared.some(
      (r) => r.employeeId === employeeId && r.date === date && r.officeId === officeId,
    );
    return declared ? 'self-declared' : null;
  }

  setSelfDeclaredAttendance(
    employeeId: string,
    date: string,
    officeId: string,
    attending: boolean,
  ): void {
    const id = key(employeeId, date, officeId);
    this.selfDeclared = this.selfDeclared.filter(
      (r) => !(r.employeeId === employeeId && r.date === date && r.officeId === officeId),
    );

    if (attending) {
      this.suppressed.delete(id);
      this.selfDeclared.push({ employeeId, date, officeId });
    } else {
      // Also override the desk feed, which we do not own and cannot edit.
      this.suppressed.add(id);
      this.removeOptIn(employeeId, date, officeId);
    }
  }

  // --- opt-ins --------------------------------------------------------------

  listOptIns(date: string, officeId: string): OptIn[] {
    return [...this.optIns.values()].filter((o) => o.date === date && o.officeId === officeId);
  }

  getOptIn(employeeId: string, date: string, officeId: string): OptIn | null {
    return this.optIns.get(key(employeeId, date, officeId)) ?? null;
  }

  setOptIn(optIn: OptIn): void {
    this.optIns.set(key(optIn.employeeId, optIn.date, optIn.officeId), optIn);
  }

  removeOptIn(employeeId: string, date: string, officeId: string): void {
    this.optIns.delete(key(employeeId, date, officeId));
  }

  // --- groups ---------------------------------------------------------------

  listGroups(date: string, officeId: string): StoredGroup[] {
    return [...this.groups.values()].filter((g) => g.date === date && g.officeId === officeId);
  }

  getGroup(groupId: string): StoredGroup | null {
    return this.groups.get(groupId) ?? null;
  }

  groupForEmployee(employeeId: string, date: string, officeId: string): StoredGroup | null {
    return (
      this.listGroups(date, officeId).find((g) => g.members.some((m) => m.id === employeeId)) ?? null
    );
  }

  saveMatchResult(result: MatchResult): void {
    this.clearGroups(result.date, result.officeId);
    this.unmatched.set(key(result.date, result.officeId), result.unmatched);
    for (const group of result.groups) {
      this.groups.set(group.id, {
        ...group,
        rsvps: Object.fromEntries(group.members.map((m) => [m.id, 'pending' as RsvpStatus])),
        invitesSentAt: null,
        cancelled: false,
      });
    }
  }

  listUnmatched(date: string, officeId: string): Unmatched[] {
    return this.unmatched.get(key(date, officeId)) ?? [];
  }

  clearGroups(date: string, officeId: string): void {
    for (const group of this.listGroups(date, officeId)) this.groups.delete(group.id);
    this.unmatched.delete(key(date, officeId));
  }

  markInvitesSent(date: string, officeId: string): void {
    const now = new Date().toISOString();
    for (const group of this.listGroups(date, officeId)) {
      if (!group.cancelled) group.invitesSentAt = now;
    }
  }

  setRsvp(groupId: string, employeeId: string, status: RsvpStatus): void {
    const group = this.groups.get(groupId);
    if (!group || !(employeeId in group.rsvps)) return;

    group.rsvps[employeeId] = status;

    // A table of two is a meeting, not a lunch. Below the minimum, cancel it and
    // say so, rather than letting two people turn up to an empty table.
    const stillComing = Object.values(group.rsvps).filter((s) => s !== 'declined').length;
    group.cancelled = stillComing < 3;
  }

  listPastMatches(): PastMatch[] {
    const fromGroups = [...this.groups.values()].map((g) => ({
      date: g.date,
      memberIds: g.members.map((m) => m.id),
    }));
    return [...this.seededHistory, ...fromGroups];
  }

  // --- demo session ---------------------------------------------------------

  getCurrentEmployeeId(): string {
    return this.currentEmployeeId;
  }

  setCurrentEmployeeId(employeeId: string): void {
    if (this.employeeById.has(employeeId)) this.currentEmployeeId = employeeId;
  }

  // --- seeding --------------------------------------------------------------

  /** Roughly three office days a week per person, as a desk tool would report. */
  private seedDeskBookings(seed: number): void {
    const rng = createRng(seed + 101);
    const dates = [...pastWeekdays(15), ...upcomingWeekdays(15)];

    for (const office of OFFICES) {
      const staff = this.listEmployees(office.id);
      for (const date of dates) {
        const records = staff
          .filter(() => rng() < 0.6)
          .map((e) => ({ employeeId: e.id, officeId: office.id, date }));
        this.deskFeed.ingest({ date, officeId: office.id }, records);
      }
    }
  }

  /**
   * Colleagues who have already asked for a lunch on the coming days, so the
   * console has a real pool to match on the first click. The signed-in person is
   * left out, so their own opt-in flow is still there to walk through.
   */
  private seedOptIns(seed: number): void {
    const rng = createRng(seed + 303);

    for (const office of OFFICES) {
      for (const date of upcomingWeekdays(15)) {
        for (const employee of this.listEmployees(office.id)) {
          if (employee.id === this.currentEmployeeId) continue;
          if (rng() >= 0.35) continue;
          this.optIns.set(key(employee.id, date, office.id), {
            employeeId: employee.id,
            date,
            officeId: office.id,
            slot: SLOT,
          });
        }
      }
    }
  }

  /**
   * Three past lunches per office, so the cooldown and novelty scoring have
   * something real to work against on the very first run.
   */
  private seedHistory(seed: number): void {
    const rng = createRng(seed + 202);
    const dates = pastWeekdays(15).filter((_, i) => i % 5 === 2).slice(-3);

    for (const office of OFFICES) {
      for (const date of dates) {
        const attending = this.listEmployees(office.id).filter(() => rng() < 0.35);
        const result = matchLunches({
          date,
          officeId: office.id,
          slot: SLOT,
          employees: this.employees,
          optIns: attending.map((e) => ({
            employeeId: e.id,
            date,
            officeId: office.id,
            slot: SLOT,
          })),
          pastMatches: this.seededHistory,
        });
        for (const group of result.groups) {
          this.seededHistory.push({ date, memberIds: group.members.map((m) => m.id) });
        }
      }
    }
  }
}

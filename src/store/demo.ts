import { matchLunches } from '../core/matcher';
import { applyRsvp } from '../core/reseating';
import { createRng } from '../core/rng';
import { DEFAULT_CONFIG } from '../core/types';
import type { Employee, MatchResult, OptIn, PastMatch, Unmatched } from '../core/types';
import { generateCompany } from '../sim/company';
import { FEATURED_EMPLOYEE } from './featured';
import { CompositeAttendanceProvider } from '../providers/composite';
import { ManualAttendanceProvider } from '../providers/manual';
import { WebhookAttendanceProvider } from '../providers/webhook';
import type { AttendanceProvider, AttendanceRecord } from '../providers/types';
import { pastWeekdays, todayInZone, upcomingWeekdays } from '../lib/dates';
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
 * is exactly the shape a desk-booking tool pushing to us would take, so the demo
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

  private readonly config = DEFAULT_CONFIG;

  constructor(seed = 7, size = 240) {
    // The demo account is a colleague like any other: same office days, same
    // pool, same matcher. Listed first so the switcher opens on him.
    this.employees = [
      FEATURED_EMPLOYEE,
      ...generateCompany({
        size: size - 1,
        offices: OFFICES.map((o) => o.id),
        seed,
        officeLanguages: OFFICE_LANGUAGES,
      }),
    ];
    this.employeeById = new Map(this.employees.map((e) => [e.id, e]));

    const bookings = this.seedDeskBookings(seed);
    this.seedHistory(seed);
    this.seedOptIns(seed, bookings);
  }

  /**
   * The synthetic world this store was seeded with, so another Store
   * implementation can be built on exactly the same data. That is what makes a
   * contract test possible: run one suite against both and any disagreement is
   * a bug in one of them rather than a difference in fixtures.
   */
  world(): {
    employees: Employee[];
    offices: Office[];
    attendance: AttendanceProvider;
    history: PastMatch[];
    optIns: OptIn[];
  } {
    return {
      employees: [...this.employees],
      offices: [...OFFICES],
      attendance: this.deskFeed,
      history: [...this.seededHistory],
      optIns: [...this.optIns.values()],
    };
  }

  // --- reference data -------------------------------------------------------

  async listOffices(): Promise<Office[]> {
    return OFFICES;
  }

  async getOffice(officeId: string): Promise<Office | undefined> {
    return OFFICES.find((o) => o.id === officeId);
  }

  async listEmployees(officeId?: string): Promise<Employee[]> {
    return this.staffAt(officeId);
  }

  /** Synchronous read for seeding, which happens before anything can await. */
  private staffAt(officeId?: string): Employee[] {
    return officeId ? this.employees.filter((e) => e.officeId === officeId) : this.employees;
  }

  async getEmployee(employeeId: string): Promise<Employee | undefined> {
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

  async setSelfDeclaredAttendance(
    employeeId: string,
    date: string,
    officeId: string,
    attending: boolean,
  ): Promise<void> {
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
      await this.removeOptIn(employeeId, date, officeId);
    }
  }

  // --- opt-ins --------------------------------------------------------------

  async listOptIns(date: string, officeId: string): Promise<OptIn[]> {
    return [...this.optIns.values()].filter((o) => o.date === date && o.officeId === officeId);
  }

  async getOptIn(employeeId: string, date: string, officeId: string): Promise<OptIn | null> {
    return this.optIns.get(key(employeeId, date, officeId)) ?? null;
  }

  async setOptIn(optIn: OptIn): Promise<void> {
    this.optIns.set(key(optIn.employeeId, optIn.date, optIn.officeId), optIn);
  }

  async removeOptIn(employeeId: string, date: string, officeId: string): Promise<void> {
    this.optIns.delete(key(employeeId, date, officeId));
  }

  // --- groups ---------------------------------------------------------------

  async listGroups(date: string, officeId: string): Promise<StoredGroup[]> {
    return this.groupsOn(date, officeId);
  }

  /** The same read, synchronously, for this class's own internals. */
  private groupsOn(date: string, officeId: string): StoredGroup[] {
    return [...this.groups.values()].filter((g) => g.date === date && g.officeId === officeId);
  }

  async getGroup(groupId: string): Promise<StoredGroup | null> {
    return this.groups.get(groupId) ?? null;
  }

  async groupForEmployee(
    employeeId: string,
    date: string,
    officeId: string,
  ): Promise<StoredGroup | null> {
    return (
      this.groupsOn(date, officeId).find((g) => g.members.some((m) => m.id === employeeId)) ?? null
    );
  }

  async saveMatchResult(result: MatchResult): Promise<void> {
    await this.clearGroups(result.date, result.officeId);
    this.unmatched.set(key(result.date, result.officeId), result.unmatched);
    for (const group of result.groups) {
      this.groups.set(group.id, {
        ...group,
        rsvps: Object.fromEntries(group.members.map((m) => [m.id, 'pending' as RsvpStatus])),
        invitesSentAt: null,
        cancellationSentAt: null,
        cancelled: false,
        sequence: 0,
      });
    }
  }

  async listUnmatched(date: string, officeId: string): Promise<Unmatched[]> {
    return this.unmatched.get(key(date, officeId)) ?? [];
  }

  async clearGroups(date: string, officeId: string): Promise<void> {
    for (const group of this.groupsOn(date, officeId)) this.groups.delete(group.id);
    this.unmatched.delete(key(date, officeId));
  }

  async markInviteSent(groupId: string): Promise<void> {
    const group = this.groups.get(groupId);
    if (group) group.invitesSentAt = new Date().toISOString();
  }

  async markCancellationSent(groupId: string): Promise<void> {
    const group = this.groups.get(groupId);
    if (group) group.cancellationSentAt = new Date().toISOString();
  }

  async setRsvp(groupId: string, employeeId: string, status: RsvpStatus): Promise<void> {
    const group = this.groups.get(groupId);
    if (!group) return;

    // The tables are the stored objects, so applying the reply mutates them in
    // place and there is nothing to write back.
    applyRsvp({
      tables: this.groupsOn(group.date, group.officeId),
      groupId,
      employeeId,
      status,
      pastMatches: this.pastMatches(),
      config: this.config,
    });
  }

  async listPastMatches(): Promise<PastMatch[]> {
    return this.pastMatches();
  }

  private pastMatches(): PastMatch[] {
    const fromGroups = [...this.groups.values()].map((g) => ({
      date: g.date,
      memberIds: g.members.map((m) => m.id),
    }));
    return [...this.seededHistory, ...fromGroups];
  }

  // --- seeding --------------------------------------------------------------

  /**
   * Roughly three office days a week per person, as a desk tool would report.
   * Returns who was booked where, so the rest of the seeding can use it without
   * going back through the async provider, which the constructor cannot await.
   */
  private seedDeskBookings(seed: number): Map<string, Set<string>> {
    const rng = createRng(seed + 101);
    const bookings = new Map<string, Set<string>>();

    for (const office of OFFICES) {
      const today = todayInZone(office.timeZone);
      const dates = [...pastWeekdays(15, today), ...upcomingWeekdays(15, today)];
      const staff = this.staffAt(office.id);
      for (const date of dates) {
        const booked = staff.filter(() => rng() < 0.6);
        this.deskFeed.ingest(
          { date, officeId: office.id },
          booked.map((e) => ({ employeeId: e.id, officeId: office.id, date })),
        );
        bookings.set(key(date, office.id), new Set(booked.map((e) => e.id)));
      }
    }
    return bookings;
  }

  /**
   * Colleagues who have already asked for a lunch on the coming days, so the
   * console has a real pool to match on the first click. Roughly a third of the
   * people in the building on a given day, which leaves any visitor a mix of
   * days already ticked and days still to decide.
   */
  private seedOptIns(seed: number, bookings: Map<string, Set<string>>): void {
    const rng = createRng(seed + 303);

    for (const office of OFFICES) {
      for (const date of upcomingWeekdays(15, todayInZone(office.timeZone))) {
        // Only people who will actually be in the building can ask for a lunch.
        // Seeding without this check produced opt-ins for people marked "not in
        // the office", which the matcher ignored but the UI happily displayed.
        const attending = bookings.get(key(date, office.id)) ?? new Set<string>();
        for (const employee of this.staffAt(office.id)) {
          if (!attending.has(employee.id)) continue;
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

    for (const office of OFFICES) {
      const dates = pastWeekdays(15, todayInZone(office.timeZone))
        .filter((_, i) => i % 5 === 2)
        .slice(-3);
      for (const date of dates) {
        const attending = this.staffAt(office.id).filter(() => rng() < 0.35);
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

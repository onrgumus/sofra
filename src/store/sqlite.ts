import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyRsvp, type SeatedTable } from '../core/reseating';
import { DEFAULT_CONFIG } from '../core/types';
import type { Employee, MatchResult, OptIn, PastMatch, Relaxation, Unmatched } from '../core/types';
import type { AttendanceProvider } from '../providers/types';
import type { AttendanceSource, Office, RsvpStatus, Store, StoredGroup } from './types';

/**
 * Loaded at runtime rather than imported.
 *
 * node:sqlite is newer than the built-in module lists that Vite and webpack
 * carry, so a static import is rewritten to a bare "sqlite" and fails to
 * resolve. Going through createRequire keeps the string out of their sight and
 * hands it to Node, which does have it. Types come from the type-only import
 * below, which is erased at compile time and so costs nothing.
 */
type Sqlite = typeof import('node:sqlite');
type Database = InstanceType<Sqlite['DatabaseSync']>;

const loadSqlite = (): Sqlite => createRequire(import.meta.url)('node:sqlite') as Sqlite;

export interface SqliteStoreOptions {
  /** File path, or ':memory:' for a database that dies with the process. */
  path: string;
  /** Reference data, from a directory sync in production. */
  employees: readonly Employee[];
  offices: readonly Office[];
  /** The desk-booking feed. Its answers are not stored, only overridden. */
  attendance: AttendanceProvider;
}

/**
 * A Store that survives a restart.
 *
 * SQLite rather than Postgres because it ships with Node, which means this can
 * be tested for real rather than reviewed and hoped over. The SQL is ordinary:
 * the schema comments note the two type changes Postgres needs.
 *
 * Reference data stays injected. What is persisted is what changes: who said
 * they would be in, who asked for a lunch, the tables, the replies, and above
 * all whether an invite has already been sent.
 */
export class SqliteStore implements Store {
  private readonly db: Database;
  private readonly employeeById: Map<string, Employee>;
  private readonly config = DEFAULT_CONFIG;

  constructor(private readonly options: SqliteStoreOptions) {
    this.db = new (loadSqlite().DatabaseSync)(options.path);
    this.db.exec('PRAGMA foreign_keys = ON');
    this.db.exec(readSchema());
    this.employeeById = new Map(options.employees.map((e) => [e.id, e]));
  }

  close(): void {
    this.db.close();
  }

  // --- reference data -------------------------------------------------------

  async listOffices(): Promise<Office[]> {
    return [...this.options.offices];
  }

  async getOffice(officeId: string): Promise<Office | undefined> {
    return this.options.offices.find((o) => o.id === officeId);
  }

  async listEmployees(officeId?: string): Promise<Employee[]> {
    const all = [...this.options.employees];
    return officeId ? all.filter((e) => e.officeId === officeId) : all;
  }

  async getEmployee(employeeId: string): Promise<Employee | undefined> {
    return this.employeeById.get(employeeId);
  }

  // --- attendance -----------------------------------------------------------

  async getAttendance(date: string, officeId: string): Promise<string[]> {
    const fromFeed = await this.options.attendance.getAttendance({ date, officeId });
    const declared = this.all<{ employee_id: string }>(
      'SELECT employee_id FROM self_declared_attendance WHERE date = ? AND office_id = ?',
      date,
      officeId,
    ).map((r) => r.employee_id);

    const suppressed = new Set(
      this.all<{ employee_id: string }>(
        'SELECT employee_id FROM suppressed_attendance WHERE date = ? AND office_id = ?',
        date,
        officeId,
      ).map((r) => r.employee_id),
    );

    const everyone = new Set([...fromFeed.map((r) => r.employeeId), ...declared]);
    return [...everyone].filter((id) => !suppressed.has(id));
  }

  async attendanceSource(
    employeeId: string,
    date: string,
    officeId: string,
  ): Promise<AttendanceSource | null> {
    if (
      this.get(
        'SELECT 1 FROM suppressed_attendance WHERE employee_id = ? AND date = ? AND office_id = ?',
        employeeId,
        date,
        officeId,
      )
    ) {
      return null;
    }

    const feed = await this.options.attendance.getAttendance({ date, officeId });
    if (feed.some((r) => r.employeeId === employeeId)) return 'desk-booking';

    return this.get(
      'SELECT 1 FROM self_declared_attendance WHERE employee_id = ? AND date = ? AND office_id = ?',
      employeeId,
      date,
      officeId,
    )
      ? 'self-declared'
      : null;
  }

  async setSelfDeclaredAttendance(
    employeeId: string,
    date: string,
    officeId: string,
    attending: boolean,
  ): Promise<void> {
    this.run(
      'DELETE FROM self_declared_attendance WHERE employee_id = ? AND date = ? AND office_id = ?',
      employeeId,
      date,
      officeId,
    );

    if (attending) {
      this.run(
        'DELETE FROM suppressed_attendance WHERE employee_id = ? AND date = ? AND office_id = ?',
        employeeId,
        date,
        officeId,
      );
      this.run(
        'INSERT INTO self_declared_attendance (employee_id, date, office_id) VALUES (?, ?, ?)',
        employeeId,
        date,
        officeId,
      );
      return;
    }

    this.run(
      'INSERT OR IGNORE INTO suppressed_attendance (employee_id, date, office_id) VALUES (?, ?, ?)',
      employeeId,
      date,
      officeId,
    );
    await this.removeOptIn(employeeId, date, officeId);
  }

  // --- opt-ins --------------------------------------------------------------

  async listOptIns(date: string, officeId: string): Promise<OptIn[]> {
    return this.all<{ employee_id: string; slot: string }>(
      'SELECT employee_id, slot FROM opt_ins WHERE date = ? AND office_id = ?',
      date,
      officeId,
    ).map((r) => ({ employeeId: r.employee_id, date, officeId, slot: r.slot }));
  }

  async getOptIn(employeeId: string, date: string, officeId: string): Promise<OptIn | null> {
    const row = this.get<{ slot: string }>(
      'SELECT slot FROM opt_ins WHERE employee_id = ? AND date = ? AND office_id = ?',
      employeeId,
      date,
      officeId,
    );
    return row ? { employeeId, date, officeId, slot: row.slot } : null;
  }

  async setOptIn(optIn: OptIn): Promise<void> {
    this.run(
      `INSERT INTO opt_ins (employee_id, date, office_id, slot) VALUES (?, ?, ?, ?)
       ON CONFLICT (employee_id, date, office_id) DO UPDATE SET slot = excluded.slot`,
      optIn.employeeId,
      optIn.date,
      optIn.officeId,
      optIn.slot,
    );
  }

  async removeOptIn(employeeId: string, date: string, officeId: string): Promise<void> {
    this.run(
      'DELETE FROM opt_ins WHERE employee_id = ? AND date = ? AND office_id = ?',
      employeeId,
      date,
      officeId,
    );
  }

  // --- groups ---------------------------------------------------------------

  async listGroups(date: string, officeId: string): Promise<StoredGroup[]> {
    return this.groupsOn(date, officeId);
  }

  async getGroup(groupId: string): Promise<StoredGroup | null> {
    const row = this.get<GroupRow>('SELECT * FROM groups WHERE id = ?', groupId);
    return row ? this.hydrate(row) : null;
  }

  async groupForEmployee(
    employeeId: string,
    date: string,
    officeId: string,
  ): Promise<StoredGroup | null> {
    const row = this.get<GroupRow>(
      `SELECT g.* FROM groups g
       JOIN group_members m ON m.group_id = g.id
       WHERE m.employee_id = ? AND g.date = ? AND g.office_id = ?`,
      employeeId,
      date,
      officeId,
    );
    return row ? this.hydrate(row) : null;
  }

  async saveMatchResult(result: MatchResult): Promise<void> {
    this.transaction(() => {
      this.clearDay(result.date, result.officeId);

      for (const group of result.groups) {
        this.run(
          `INSERT INTO groups
             (id, date, office_id, slot, score, relaxation, common_languages, cancelled, sequence)
           VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0)`,
          group.id,
          group.date,
          group.officeId,
          group.slot,
          group.score,
          group.relaxation,
          JSON.stringify(group.commonLanguages),
        );
        group.members.forEach((member, seat) => {
          this.run(
            'INSERT INTO group_members (group_id, employee_id, seat, rsvp) VALUES (?, ?, ?, ?)',
            group.id,
            member.id,
            seat,
            'pending',
          );
        });
      }

      for (const entry of result.unmatched) {
        this.run(
          'INSERT OR REPLACE INTO unmatched (date, office_id, employee_id, reason) VALUES (?, ?, ?, ?)',
          result.date,
          result.officeId,
          entry.employee.id,
          entry.reason,
        );
      }
    });
  }

  async listUnmatched(date: string, officeId: string): Promise<Unmatched[]> {
    return this.all<{ employee_id: string; reason: string }>(
      'SELECT employee_id, reason FROM unmatched WHERE date = ? AND office_id = ?',
      date,
      officeId,
    )
      .map((r) => {
        const employee = this.employeeById.get(r.employee_id);
        return employee ? { employee, reason: r.reason as Unmatched['reason'] } : null;
      })
      .filter((u): u is Unmatched => u !== null);
  }

  async clearGroups(date: string, officeId: string): Promise<void> {
    this.transaction(() => this.clearDay(date, officeId));
  }

  async markInviteSent(groupId: string): Promise<void> {
    this.run(
      'UPDATE groups SET invites_sent_at = ? WHERE id = ?',
      new Date().toISOString(),
      groupId,
    );
  }

  async markCancellationSent(groupId: string): Promise<void> {
    this.run(
      'UPDATE groups SET cancellation_sent_at = ? WHERE id = ?',
      new Date().toISOString(),
      groupId,
    );
  }

  async setRsvp(groupId: string, employeeId: string, status: RsvpStatus): Promise<void> {
    const group = await this.getGroup(groupId);
    if (!group) return;

    const tables = this.groupsOn(group.date, group.officeId);
    const changed = applyRsvp({
      tables,
      groupId,
      employeeId,
      status,
      pastMatches: await this.listPastMatches(),
      config: this.config,
    });

    // The reseating logic works on plain objects, so persisting is a matter of
    // writing back whichever tables it touched.
    this.transaction(() => {
      for (const table of changed) this.persist(table as StoredGroup);
    });
  }

  async listPastMatches(): Promise<PastMatch[]> {
    const seeded = this.all<{ date: string; member_ids: string }>(
      'SELECT date, member_ids FROM past_matches',
    ).map((r) => ({ date: r.date, memberIds: JSON.parse(r.member_ids) as string[] }));

    const live = this.all<{ id: string; date: string }>('SELECT id, date FROM groups').map((g) => ({
      date: g.date,
      memberIds: this.memberIds(g.id),
    }));

    return [...seeded, ...live];
  }

  /** Import lunches that happened before this database existed. */
  recordPastMatches(matches: readonly PastMatch[]): void {
    this.transaction(() => {
      for (const match of matches) {
        this.run(
          'INSERT INTO past_matches (date, member_ids) VALUES (?, ?)',
          match.date,
          JSON.stringify(match.memberIds),
        );
      }
    });
  }

  // --- internals ------------------------------------------------------------

  private clearDay(date: string, officeId: string): void {
    // Members go with the group via ON DELETE CASCADE.
    this.run('DELETE FROM groups WHERE date = ? AND office_id = ?', date, officeId);
    this.run('DELETE FROM unmatched WHERE date = ? AND office_id = ?', date, officeId);
  }

  private groupsOn(date: string, officeId: string): StoredGroup[] {
    return this.all<GroupRow>(
      'SELECT * FROM groups WHERE date = ? AND office_id = ? ORDER BY id',
      date,
      officeId,
    ).map((row) => this.hydrate(row));
  }

  private hydrate(row: GroupRow): StoredGroup {
    const seats = this.all<{ employee_id: string; rsvp: string }>(
      'SELECT employee_id, rsvp FROM group_members WHERE group_id = ? ORDER BY seat',
      row.id,
    );

    const members = seats
      .map((s) => this.employeeById.get(s.employee_id))
      .filter((e): e is Employee => e !== undefined);

    return {
      id: row.id,
      date: row.date,
      officeId: row.office_id,
      slot: row.slot,
      members,
      score: row.score,
      relaxation: row.relaxation as Relaxation,
      commonLanguages: JSON.parse(row.common_languages) as string[],
      rsvps: Object.fromEntries(seats.map((s) => [s.employee_id, s.rsvp as RsvpStatus])),
      invitesSentAt: row.invites_sent_at,
      cancellationSentAt: row.cancellation_sent_at,
      cancelled: row.cancelled === 1,
      sequence: row.sequence,
    };
  }

  /** Writes a table back, replacing its seats so a move is reflected exactly. */
  private persist(group: StoredGroup): void {
    this.run(
      `UPDATE groups SET cancelled = ?, sequence = ?, invites_sent_at = ?, cancellation_sent_at = ?
       WHERE id = ?`,
      group.cancelled ? 1 : 0,
      group.sequence,
      group.invitesSentAt,
      group.cancellationSentAt,
      group.id,
    );
    this.run('DELETE FROM group_members WHERE group_id = ?', group.id);
    group.members.forEach((member, seat) => {
      this.run(
        'INSERT INTO group_members (group_id, employee_id, seat, rsvp) VALUES (?, ?, ?, ?)',
        group.id,
        member.id,
        seat,
        group.rsvps[member.id] ?? 'pending',
      );
    });
  }

  private memberIds(groupId: string): string[] {
    return this.all<{ employee_id: string }>(
      'SELECT employee_id FROM group_members WHERE group_id = ? ORDER BY seat',
      groupId,
    ).map((r) => r.employee_id);
  }

  private transaction(work: () => void): void {
    this.db.exec('BEGIN');
    try {
      work();
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  private run(sql: string, ...params: SqlValue[]): void {
    this.db.prepare(sql).run(...params);
  }

  private get<T>(sql: string, ...params: SqlValue[]): T | undefined {
    return this.db.prepare(sql).get(...params) as T | undefined;
  }

  private all<T>(sql: string, ...params: SqlValue[]): T[] {
    return this.db.prepare(sql).all(...params) as T[];
  }
}

type SqlValue = string | number | null;

interface GroupRow {
  id: string;
  date: string;
  office_id: string;
  slot: string;
  score: number;
  relaxation: string;
  common_languages: string;
  cancelled: number;
  sequence: number;
  invites_sent_at: string | null;
  cancellation_sent_at: string | null;
}

function readSchema(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return readFileSync(join(here, 'schema.sql'), 'utf8');
}

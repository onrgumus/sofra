import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyRsvp } from '../core/reseating';
import { DEFAULT_CONFIG } from '../core/types';
import type { Employee, MatchResult, OptIn, PastMatch, Relaxation, Unmatched } from '../core/types';
import type { AttendanceProvider } from '../providers/types';
import type { EmployeeProfile } from '../core/profile';
import { withProfile } from '../core/profile';
import type { Directory } from '../directory/types';
import type { AdminGrant, AttendanceSource, Office, RsvpStatus, Store, StoredGroup } from './types';

/**
 * The bit of `pg` this store uses. Typed structurally so a test can hand it an
 * in-process Postgres without the real driver being involved.
 */
export interface PgPool {
  query(text: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
  connect(): Promise<PgClient>;
  end?(): Promise<void>;
}

export interface PgClient {
  query(text: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
  release(): void;
}

export interface PostgresStoreOptions {
  pool: PgPool;
  /** Where the company's people come from. See `src/directory`. */
  directory: Directory;
  offices: readonly Office[];
  attendance: AttendanceProvider;
}

/**
 * The Store on Postgres, which is what a deployment on Vercel needs: its
 * filesystem is ephemeral, so the SQLite file would be empty on every cold
 * start and the "already sent" record would be lost exactly as it was before
 * any database existed.
 *
 * Same behaviour as the SQLite store and held to the same contract suite. The
 * one thing that had to be rebuilt rather than translated is how a reply stays
 * atomic: SQLite got that from running the whole read-modify-write
 * synchronously, and nothing here is synchronous, so the day is locked instead.
 */
export class PostgresStore implements Store {
  /**
   * Filled on first use and kept for the life of the process. A directory is a
   * file or an HTTP call, and re-reading it on every page would turn one lunch
   * page into a few hundred lookups.
   */
  private employeeById: Map<string, Employee> | null = null;
  private readonly config = DEFAULT_CONFIG;
  private ready: Promise<void> | null = null;

  constructor(private readonly options: PostgresStoreOptions) {}

  /** Applies the schema once, and only once, however many callers race here. */
  private migrate(): Promise<void> {
    this.ready ??= this.options.pool.query(readSchema()).then(() => undefined);
    return this.ready;
  }

  private async query<T>(text: string, values: unknown[] = []): Promise<T[]> {
    await this.migrate();
    const result = await this.options.pool.query(text, values);
    return result.rows as T[];
  }

  private async one<T>(text: string, values: unknown[] = []): Promise<T | undefined> {
    return (await this.query<T>(text, values))[0];
  }

  // --- reference data -------------------------------------------------------

  async listOffices(): Promise<Office[]> {
    return [...this.options.offices];
  }

  async getOffice(officeId: string): Promise<Office | undefined> {
    return this.options.offices.find((o) => o.id === officeId);
  }

  async listEmployees(officeId?: string): Promise<Employee[]> {
    const all = [...(await this.people()).values()];
    const wanted = officeId ? all.filter((e) => e.officeId === officeId) : all;

    // One query for everybody rather than one per person: the matcher calls
    // this with a whole building, and a round trip each would be thousands.
    const rows = await this.query<ProfileRow>('SELECT * FROM profiles');
    const profiles = new Map(rows.map((r) => [r.employee_id, toProfile(r)]));
    return wanted.map((e) => withProfile(e, profiles.get(e.id) ?? null));
  }

  async getEmployee(employeeId: string): Promise<Employee | undefined> {
    const employee = (await this.people()).get(employeeId);
    return employee ? withProfile(employee, await this.getProfile(employeeId)) : undefined;
  }

  async getProfile(employeeId: string): Promise<EmployeeProfile | null> {
    const rows = await this.query<ProfileRow>('SELECT * FROM profiles WHERE employee_id = $1', [
      employeeId,
    ]);
    return rows[0] ? toProfile(rows[0]) : null;
  }

  async setProfile(profile: EmployeeProfile): Promise<void> {
    await this.query(
      `INSERT INTO profiles (employee_id, languages, interests, updated_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (employee_id) DO UPDATE SET languages = EXCLUDED.languages,
         interests = EXCLUDED.interests, updated_at = EXCLUDED.updated_at`,
      [
        profile.employeeId,
        JSON.stringify(profile.languages),
        JSON.stringify(profile.interests),
        profile.updatedAt,
      ],
    );
  }

  private async people(): Promise<Map<string, Employee>> {
    this.employeeById ??= new Map(
      (await this.options.directory.listEmployees()).map((e) => [e.id, e]),
    );
    return this.employeeById;
  }

  // --- attendance -----------------------------------------------------------

  async getAttendance(date: string, officeId: string): Promise<string[]> {
    const fromFeed = await this.options.attendance.getAttendance({ date, officeId });

    const declared = await this.query<{ employee_id: string }>(
      'SELECT employee_id FROM self_declared_attendance WHERE date = $1 AND office_id = $2',
      [date, officeId],
    );
    const suppressed = new Set(
      (
        await this.query<{ employee_id: string }>(
          'SELECT employee_id FROM suppressed_attendance WHERE date = $1 AND office_id = $2',
          [date, officeId],
        )
      ).map((r) => r.employee_id),
    );

    const everyone = new Set([
      ...fromFeed.map((r) => r.employeeId),
      ...declared.map((r) => r.employee_id),
    ]);
    return [...everyone].filter((id) => !suppressed.has(id));
  }

  async attendanceSource(
    employeeId: string,
    date: string,
    officeId: string,
  ): Promise<AttendanceSource | null> {
    const suppressed = await this.one(
      'SELECT 1 FROM suppressed_attendance WHERE employee_id = $1 AND date = $2 AND office_id = $3',
      [employeeId, date, officeId],
    );
    if (suppressed) return null;

    const feed = await this.options.attendance.getAttendance({ date, officeId });
    if (feed.some((r) => r.employeeId === employeeId)) return 'desk-booking';

    const declared = await this.one(
      'SELECT 1 FROM self_declared_attendance WHERE employee_id = $1 AND date = $2 AND office_id = $3',
      [employeeId, date, officeId],
    );
    return declared ? 'self-declared' : null;
  }

  async setSelfDeclaredAttendance(
    employeeId: string,
    date: string,
    officeId: string,
    attending: boolean,
  ): Promise<void> {
    await this.query(
      'DELETE FROM self_declared_attendance WHERE employee_id = $1 AND date = $2 AND office_id = $3',
      [employeeId, date, officeId],
    );

    if (attending) {
      await this.query(
        'DELETE FROM suppressed_attendance WHERE employee_id = $1 AND date = $2 AND office_id = $3',
        [employeeId, date, officeId],
      );
      await this.query(
        'INSERT INTO self_declared_attendance (employee_id, date, office_id) VALUES ($1, $2, $3)',
        [employeeId, date, officeId],
      );
      return;
    }

    await this.query(
      `INSERT INTO suppressed_attendance (employee_id, date, office_id) VALUES ($1, $2, $3)
       ON CONFLICT DO NOTHING`,
      [employeeId, date, officeId],
    );
    await this.removeOptIn(employeeId, date, officeId);

    // Not coming in is not coming to lunch. Leaving the seat behind meant three
    // people kept expecting somebody who had said they would not be there, and
    // a table that should have collapsed did not. A decline runs the reseating
    // the invite already promises.
    const seated = await this.groupForEmployee(employeeId, date, officeId);
    if (seated) await this.setRsvp(seated.id, employeeId, 'declined');
  }

  // --- opt-ins --------------------------------------------------------------

  async listOptIns(date: string, officeId: string): Promise<OptIn[]> {
    const rows = await this.query<{ employee_id: string; slot: string }>(
      'SELECT employee_id, slot FROM opt_ins WHERE date = $1 AND office_id = $2',
      [date, officeId],
    );
    return rows.map((r) => ({ employeeId: r.employee_id, date, officeId, slot: r.slot }));
  }

  async getOptIn(employeeId: string, date: string, officeId: string): Promise<OptIn | null> {
    const row = await this.one<{ slot: string }>(
      'SELECT slot FROM opt_ins WHERE employee_id = $1 AND date = $2 AND office_id = $3',
      [employeeId, date, officeId],
    );
    return row ? { employeeId, date, officeId, slot: row.slot } : null;
  }

  async setOptIn(optIn: OptIn): Promise<void> {
    await this.query(
      `INSERT INTO opt_ins (employee_id, date, office_id, slot) VALUES ($1, $2, $3, $4)
       ON CONFLICT (employee_id, date, office_id) DO UPDATE SET slot = EXCLUDED.slot`,
      [optIn.employeeId, optIn.date, optIn.officeId, optIn.slot],
    );
  }

  async removeOptIn(employeeId: string, date: string, officeId: string): Promise<void> {
    await this.query(
      'DELETE FROM opt_ins WHERE employee_id = $1 AND date = $2 AND office_id = $3',
      [employeeId, date, officeId],
    );
  }

  // --- groups ---------------------------------------------------------------

  async listGroups(date: string, officeId: string): Promise<StoredGroup[]> {
    const rows = await this.query<GroupRow>(
      'SELECT * FROM groups WHERE date = $1 AND office_id = $2 ORDER BY id',
      [date, officeId],
    );
    return Promise.all(rows.map((row) => this.hydrate(row)));
  }

  async getGroup(groupId: string): Promise<StoredGroup | null> {
    const row = await this.one<GroupRow>('SELECT * FROM groups WHERE id = $1', [groupId]);
    return row ? this.hydrate(row) : null;
  }

  async groupForEmployee(
    employeeId: string,
    date: string,
    officeId: string,
  ): Promise<StoredGroup | null> {
    const row = await this.one<GroupRow>(
      `SELECT g.* FROM groups g
       JOIN group_members m ON m.group_id = g.id
       WHERE m.employee_id = $1 AND g.date = $2 AND g.office_id = $3`,
      [employeeId, date, officeId],
    );
    return row ? this.hydrate(row) : null;
  }

  async saveMatchResult(result: MatchResult): Promise<void> {
    await this.migrate();
    await this.inTransaction(async (client) => {
      await client.query('DELETE FROM groups WHERE date = $1 AND office_id = $2', [
        result.date,
        result.officeId,
      ]);
      await client.query('DELETE FROM unmatched WHERE date = $1 AND office_id = $2', [
        result.date,
        result.officeId,
      ]);

      for (const group of result.groups) {
        await client.query(
          `INSERT INTO groups
             (id, date, office_id, slot, score, relaxation, common_languages, cancelled, sequence)
           VALUES ($1, $2, $3, $4, $5, $6, $7, FALSE, 0)`,
          [
            group.id,
            group.date,
            group.officeId,
            group.slot,
            group.score,
            group.relaxation,
            JSON.stringify(group.commonLanguages),
          ],
        );
        for (const [seat, member] of group.members.entries()) {
          await client.query(
            'INSERT INTO group_members (group_id, employee_id, seat, rsvp) VALUES ($1, $2, $3, $4)',
            [group.id, member.id, seat, 'pending'],
          );
        }
      }

      for (const entry of result.unmatched) {
        await client.query(
          `INSERT INTO unmatched (date, office_id, employee_id, reason) VALUES ($1, $2, $3, $4)
           ON CONFLICT (date, office_id, employee_id) DO UPDATE SET reason = EXCLUDED.reason`,
          [result.date, result.officeId, entry.employee.id, entry.reason],
        );
      }
    });
  }

  async listUnmatched(date: string, officeId: string): Promise<Unmatched[]> {
    const people = await this.people();
    const rows = await this.query<{ employee_id: string; reason: string }>(
      'SELECT employee_id, reason FROM unmatched WHERE date = $1 AND office_id = $2',
      [date, officeId],
    );
    return rows
      .map((r) => {
        const employee = people.get(r.employee_id);
        return employee ? { employee, reason: r.reason as Unmatched['reason'] } : null;
      })
      .filter((u): u is Unmatched => u !== null);
  }

  async clearGroups(date: string, officeId: string): Promise<void> {
    await this.query('DELETE FROM groups WHERE date = $1 AND office_id = $2', [date, officeId]);
    await this.query('DELETE FROM unmatched WHERE date = $1 AND office_id = $2', [date, officeId]);
  }

  async markInviteSent(groupId: string): Promise<void> {
    await this.query('UPDATE groups SET invites_sent_at = $1 WHERE id = $2', [
      new Date().toISOString(),
      groupId,
    ]);
  }

  async markCancellationSent(groupId: string): Promise<void> {
    await this.query('UPDATE groups SET cancellation_sent_at = $1 WHERE id = $2', [
      new Date().toISOString(),
      groupId,
    ]);
  }

  async setRsvp(groupId: string, employeeId: string, status: RsvpStatus): Promise<void> {
    await this.migrate();

    // A reply is a read-modify-write across every table that day, because a
    // decline can move people between them. Two replies arriving together would
    // each read state the other has not written and the last write would win,
    // losing a collapse or a move. SQLite avoided that by being synchronous;
    // here the day is locked for the duration, so concurrent replies queue.
    await this.inTransaction(async (client) => {
      const located = await client.query('SELECT date, office_id FROM groups WHERE id = $1', [
        groupId,
      ]);
      const row = located.rows[0] as { date: string; office_id: string } | undefined;
      if (!row) return;

      await client.query(
        'INSERT INTO day_locks (date, office_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [row.date, row.office_id],
      );
      await client.query('SELECT 1 FROM day_locks WHERE date = $1 AND office_id = $2 FOR UPDATE', [
        row.date,
        row.office_id,
      ]);

      const tables = await this.loadDay(client, row.date, row.office_id);
      const changed = applyRsvp({
        tables,
        groupId,
        employeeId,
        status,
        pastMatches: await this.loadHistory(client),
        config: this.config,
      });

      for (const table of changed) await this.persist(client, table as StoredGroup);
    });
  }

  async listPastMatches(): Promise<PastMatch[]> {
    await this.migrate();
    const seeded = await this.query<{ date: string; member_ids: string }>(
      'SELECT date, member_ids FROM past_matches',
    );
    const live = await this.query<{ id: string; date: string }>('SELECT id, date FROM groups');

    return [
      ...seeded.map((r) => ({ date: r.date, memberIds: JSON.parse(r.member_ids) as string[] })),
      ...(await Promise.all(
        live.map(async (g) => ({ date: g.date, memberIds: await this.memberIds(g.id) })),
      )),
    ];
  }

  /** Import lunches that happened before this database existed. */
  async recordPastMatches(matches: readonly PastMatch[]): Promise<void> {
    for (const match of matches) {
      await this.query('INSERT INTO past_matches (date, member_ids) VALUES ($1, $2)', [
        match.date,
        JSON.stringify(match.memberIds),
      ]);
    }
  }

  // --- admins ----------------------------------------------------------------

  async listAdmins(): Promise<AdminGrant[]> {
    const rows = await this.query<{ employee_id: string; granted_by: string; granted_at: string }>(
      'SELECT employee_id, granted_by, granted_at FROM admins ORDER BY granted_at',
    );
    return rows.map((r) => ({
      employeeId: r.employee_id,
      grantedBy: r.granted_by,
      grantedAt: r.granted_at,
    }));
  }

  async grantAdmin(grant: AdminGrant): Promise<void> {
    await this.query(
      `INSERT INTO admins (employee_id, granted_by, granted_at) VALUES ($1, $2, $3)
       ON CONFLICT (employee_id) DO UPDATE SET granted_by = EXCLUDED.granted_by,
         granted_at = EXCLUDED.granted_at`,
      [grant.employeeId, grant.grantedBy, grant.grantedAt],
    );
  }

  async revokeAdmin(employeeId: string): Promise<void> {
    await this.query('DELETE FROM admins WHERE employee_id = $1', [employeeId]);
  }

  // --- reminders -------------------------------------------------------------

  async listNotified(kind: string, date: string, officeId: string): Promise<string[]> {
    const rows = await this.query<{ employee_id: string }>(
      'SELECT employee_id FROM notified WHERE kind = $1 AND date = $2 AND office_id = $3',
      [kind, date, officeId],
    );
    return rows.map((r) => r.employee_id);
  }

  async recordNotified(
    kind: string,
    date: string,
    officeId: string,
    employeeIds: readonly string[],
  ): Promise<void> {
    if (employeeIds.length === 0) return;

    // One statement rather than one round trip per person: this runs over a
    // whole building, and a serverless database charges for every hop.
    const values = employeeIds.map((_, i) => `($1, $2, $3, $${i + 4})`).join(', ');
    await this.query(
      `INSERT INTO notified (kind, date, office_id, employee_id) VALUES ${values}
       ON CONFLICT DO NOTHING`,
      [kind, date, officeId, ...employeeIds],
    );
  }

  async listRemindersOff(): Promise<string[]> {
    const rows = await this.query<{ employee_id: string }>('SELECT employee_id FROM reminders_off');
    return rows.map((r) => r.employee_id);
  }

  async setReminders(employeeId: string, enabled: boolean): Promise<void> {
    if (enabled) {
      await this.query('DELETE FROM reminders_off WHERE employee_id = $1', [employeeId]);
      return;
    }
    await this.query('INSERT INTO reminders_off (employee_id) VALUES ($1) ON CONFLICT DO NOTHING', [
      employeeId,
    ]);
  }

  // --- sign-in throttling ----------------------------------------------------

  async recordSignInFailure(key: string, atIso: string): Promise<void> {
    await this.query('INSERT INTO sign_in_failures (key, at) VALUES ($1, $2)', [key, atIso]);
  }

  async countSignInFailures(key: string, sinceIso: string): Promise<number> {
    // Prune while counting: nothing older than the window can matter again.
    await this.query('DELETE FROM sign_in_failures WHERE at < $1', [sinceIso]);
    const row = await this.one<{ n: string }>(
      'SELECT COUNT(*) AS n FROM sign_in_failures WHERE key = $1 AND at >= $2',
      [key, sinceIso],
    );
    return Number(row?.n ?? 0);
  }

  async clearSignInFailures(key: string): Promise<void> {
    await this.query('DELETE FROM sign_in_failures WHERE key = $1', [key]);
  }

  // --- internals ------------------------------------------------------------

  private async inTransaction(work: (client: PgClient) => Promise<void>): Promise<void> {
    const client = await this.options.pool.connect();
    try {
      await client.query('BEGIN');
      await work(client);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private async loadDay(client: PgClient, date: string, officeId: string): Promise<StoredGroup[]> {
    const rows = await client.query(
      'SELECT * FROM groups WHERE date = $1 AND office_id = $2 ORDER BY id',
      [date, officeId],
    );
    // One client cannot run two queries at once, so these are sequential. A
    // Promise.all here is the deprecation warning pg prints and the undefined
    // behaviour it is warning about.
    const groups: StoredGroup[] = [];
    for (const row of rows.rows as unknown as GroupRow[]) {
      groups.push(await this.hydrate(row, client));
    }
    return groups;
  }

  private async loadHistory(client: PgClient): Promise<PastMatch[]> {
    const seeded = await client.query('SELECT date, member_ids FROM past_matches');
    const live = await client.query('SELECT id, date FROM groups');

    const fromGroups: PastMatch[] = [];
    for (const g of live.rows as { id: string; date: string }[]) {
      fromGroups.push({ date: g.date, memberIds: await this.memberIds(g.id, client) });
    }

    return [
      ...(seeded.rows as { date: string; member_ids: string }[]).map((r) => ({
        date: r.date,
        memberIds: JSON.parse(r.member_ids) as string[],
      })),
      ...fromGroups,
    ];
  }

  private async hydrate(row: GroupRow, client?: PgClient): Promise<StoredGroup> {
    const people = await this.people();
    const seats = await this.run<{ employee_id: string; rsvp: string }>(
      'SELECT employee_id, rsvp FROM group_members WHERE group_id = $1 ORDER BY seat',
      [row.id],
      client,
    );

    const members = seats
      .map((s) => people.get(s.employee_id))
      .filter((e): e is Employee => e !== undefined);

    return {
      id: row.id,
      date: row.date,
      officeId: row.office_id,
      slot: row.slot,
      members,
      score: Number(row.score),
      relaxation: row.relaxation as Relaxation,
      commonLanguages: JSON.parse(row.common_languages) as string[],
      rsvps: Object.fromEntries(seats.map((s) => [s.employee_id, s.rsvp as RsvpStatus])),
      invitesSentAt: row.invites_sent_at,
      cancellationSentAt: row.cancellation_sent_at,
      cancelled: row.cancelled === true,
      sequence: Number(row.sequence),
    };
  }

  /** Writes a table back, replacing its seats so a move is reflected exactly. */
  private async persist(client: PgClient, group: StoredGroup): Promise<void> {
    await client.query(
      `UPDATE groups SET cancelled = $1, sequence = $2, invites_sent_at = $3,
         cancellation_sent_at = $4 WHERE id = $5`,
      [group.cancelled, group.sequence, group.invitesSentAt, group.cancellationSentAt, group.id],
    );
    await client.query('DELETE FROM group_members WHERE group_id = $1', [group.id]);

    for (const [seat, member] of group.members.entries()) {
      await client.query(
        'INSERT INTO group_members (group_id, employee_id, seat, rsvp) VALUES ($1, $2, $3, $4)',
        [group.id, member.id, seat, group.rsvps[member.id] ?? 'pending'],
      );
    }
  }

  private async memberIds(groupId: string, client?: PgClient): Promise<string[]> {
    const rows = await this.run<{ employee_id: string }>(
      'SELECT employee_id FROM group_members WHERE group_id = $1 ORDER BY seat',
      [groupId],
      client,
    );
    return rows.map((r) => r.employee_id);
  }

  /** Inside a transaction use its client; outside, the pool. */
  private async run<T>(text: string, values: unknown[], client?: PgClient): Promise<T[]> {
    if (client) return (await client.query(text, values)).rows as T[];
    return this.query<T>(text, values);
  }
}

interface GroupRow {
  id: string;
  date: string;
  office_id: string;
  slot: string;
  score: number;
  relaxation: string;
  common_languages: string;
  cancelled: boolean;
  sequence: number;
  invites_sent_at: string | null;
  cancellation_sent_at: string | null;
}

function readSchema(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return readFileSync(join(here, 'schema.postgres.sql'), 'utf8');
}

interface ProfileRow {
  employee_id: string;
  languages: string;
  interests: string;
  updated_at: string;
}

function toProfile(row: ProfileRow): EmployeeProfile {
  return {
    employeeId: row.employee_id,
    languages: JSON.parse(row.languages) as string[],
    interests: JSON.parse(row.interests) as string[],
    updatedAt: row.updated_at,
  };
}

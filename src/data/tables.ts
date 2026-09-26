import type { Employee, MatchedGroup, PastMatch, Relaxation, UnmatchedReason } from '../core/types';
import type { Queryable } from '../db';
import { toEmployee, toPerson } from './people';
import type { RsvpStatus } from './types';

/** A table as stored: who is at it, what they said, and what has been sent. */
export interface LunchTable extends MatchedGroup {
  rsvps: Record<string, RsvpStatus>;
  cancelled: boolean;
  /** Bumped whenever the membership changes; the calendar invite's SEQUENCE. */
  sequence: number;
  /** Null once the table changed and the new invite has not gone out yet. */
  invitesSentAt: string | null;
  cancellationSentAt: string | null;
  /** The lunch as an instant, fixed when the table was made. */
  startsAt: string;
  /** The office's zone at that moment, for messages that say the time. */
  timeZone: string;
}

export interface UnseatedEntry {
  employee: Employee;
  reason: UnmatchedReason;
}

interface TableRow extends Record<string, unknown> {
  id: string;
  office_id: string;
  date: string;
  slot: string;
  starts_at: Date;
  time_zone: string;
  score: number;
  relaxation: string;
  common_languages: string[];
  cancelled: boolean;
  sequence: number;
  invites_sent_at: Date | null;
  cancellation_sent_at: Date | null;
}

/**
 * The day's tables are rebuilt one day at a time, and a reply to one of them
 * reads and rewrites all of them, because a drop-out can move people between
 * tables. Taken inside a transaction, this makes those serialise per office
 * and day, so two replies at once cannot each undo the other.
 */
export async function lockDay(tx: Queryable, officeId: string, date: string): Promise<void> {
  await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`day:${officeId}:${date}`]);
}

async function hydrate(db: Queryable, rows: TableRow[]): Promise<LunchTable[]> {
  if (rows.length === 0) return [];
  const seats = await db.query<Record<string, unknown> & { table_id: string; rsvp: string }>(
    `SELECT s.table_id, s.rsvp, s.seat, e.* FROM table_seats s
       JOIN employees e ON e.id = s.employee_id
      WHERE s.table_id = ANY($1) ORDER BY s.table_id, s.seat`,
    [rows.map((r) => r.id)],
  );

  return rows.map((row) => {
    const mine = seats.rows.filter((s) => s.table_id === row.id);
    const members = mine.map((s) =>
      toEmployee(toPerson(s as unknown as Parameters<typeof toPerson>[0]), row.office_id),
    );
    return {
      id: row.id,
      date: row.date,
      officeId: row.office_id,
      slot: row.slot,
      members,
      score: Number(row.score),
      relaxation: row.relaxation as Relaxation,
      commonLanguages: row.common_languages,
      rsvps: Object.fromEntries(mine.map((s) => [s['id'] as string, s.rsvp as RsvpStatus])),
      cancelled: row.cancelled,
      sequence: row.sequence,
      invitesSentAt: row.invites_sent_at?.toISOString() ?? null,
      cancellationSentAt: row.cancellation_sent_at?.toISOString() ?? null,
      startsAt: row.starts_at.toISOString(),
      timeZone: row.time_zone,
    };
  });
}

export async function listTables(
  db: Queryable,
  officeId: string,
  date: string,
): Promise<LunchTable[]> {
  const { rows } = await db.query<TableRow>(
    'SELECT * FROM lunch_tables WHERE office_id = $1 AND date = $2 ORDER BY slot, id',
    [officeId, date],
  );
  return hydrate(db, rows);
}

export async function getTable(db: Queryable, id: string): Promise<LunchTable | null> {
  const { rows } = await db.query<TableRow>('SELECT * FROM lunch_tables WHERE id = $1', [id]);
  return (await hydrate(db, rows))[0] ?? null;
}

/** Somebody's table on a day, wherever it is. */
export async function tableOf(
  db: Queryable,
  employeeId: string,
  date: string,
): Promise<LunchTable | null> {
  const { rows } = await db.query<TableRow>(
    `SELECT t.* FROM lunch_tables t JOIN table_seats s ON s.table_id = t.id
      WHERE s.employee_id = $1 AND t.date = $2
      ORDER BY t.cancelled, t.created_at DESC LIMIT 1`,
    [employeeId, date],
  );
  return (await hydrate(db, rows))[0] ?? null;
}

/** Somebody's tables over a range of days, one per day. */
export async function tablesOf(
  db: Queryable,
  employeeId: string,
  dates: readonly string[],
): Promise<Map<string, LunchTable>> {
  const { rows } = await db.query<TableRow>(
    `SELECT DISTINCT ON (t.date) t.* FROM lunch_tables t
       JOIN table_seats s ON s.table_id = t.id
      WHERE s.employee_id = $1 AND t.date = ANY($2::date[])
      ORDER BY t.date, t.cancelled, t.created_at DESC`,
    [employeeId, [...dates]],
  );
  const tables = await hydrate(db, rows);
  return new Map(tables.map((t) => [t.date, t]));
}

export interface DayPlan {
  officeId: string;
  date: string;
  timeZone: string;
  tables: (MatchedGroup & { startsAt: Date })[];
  unseated: { employeeId: string; reason: UnmatchedReason }[];
}

/** Replaces a day's tables with a new plan. Run inside a transaction. */
export async function replaceDay(tx: Queryable, plan: DayPlan): Promise<void> {
  await tx.query('DELETE FROM lunch_tables WHERE office_id = $1 AND date = $2', [
    plan.officeId,
    plan.date,
  ]);
  await tx.query('DELETE FROM unseated WHERE office_id = $1 AND date = $2', [
    plan.officeId,
    plan.date,
  ]);

  for (const table of plan.tables) {
    await tx.query(
      `INSERT INTO lunch_tables (id, office_id, date, slot, starts_at, time_zone, score,
         relaxation, common_languages)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        table.id,
        plan.officeId,
        plan.date,
        table.slot,
        table.startsAt,
        plan.timeZone,
        table.score,
        table.relaxation,
        table.commonLanguages,
      ],
    );
    for (const [seat, member] of table.members.entries()) {
      await tx.query('INSERT INTO table_seats (table_id, employee_id, seat) VALUES ($1, $2, $3)', [
        table.id,
        member.id,
        seat,
      ]);
    }
  }

  for (const entry of plan.unseated) {
    await tx.query(
      `INSERT INTO unseated (office_id, date, employee_id, reason) VALUES ($1, $2, $3, $4)
       ON CONFLICT DO NOTHING`,
      [plan.officeId, plan.date, entry.employeeId, entry.reason],
    );
  }
}

/** Writes tables back after a reply or a late join, seats and flags together. */
export async function saveTables(tx: Queryable, tables: readonly LunchTable[]): Promise<void> {
  for (const table of tables) {
    await tx.query(
      `UPDATE lunch_tables SET cancelled = $2, sequence = $3, invites_sent_at = $4,
         cancellation_sent_at = $5 WHERE id = $1`,
      [table.id, table.cancelled, table.sequence, table.invitesSentAt, table.cancellationSentAt],
    );
    await tx.query('DELETE FROM table_seats WHERE table_id = $1', [table.id]);
    for (const [seat, member] of table.members.entries()) {
      await tx.query(
        'INSERT INTO table_seats (table_id, employee_id, seat, rsvp) VALUES ($1, $2, $3, $4)',
        [table.id, member.id, seat, table.rsvps[member.id] ?? 'pending'],
      );
    }
  }
}

export async function markInviteSent(
  db: Queryable,
  tableId: string,
  sequence: number,
): Promise<void> {
  // Only for the version that was sent: a table that changed while its invite
  // was going out still needs the newer one.
  await db.query(
    'UPDATE lunch_tables SET invites_sent_at = now() WHERE id = $1 AND sequence = $2',
    [tableId, sequence],
  );
}

export async function markCancellationSent(db: Queryable, tableId: string): Promise<void> {
  await db.query('UPDATE lunch_tables SET cancellation_sent_at = now() WHERE id = $1', [tableId]);
}

export async function listUnseated(
  db: Queryable,
  officeId: string,
  date: string,
): Promise<UnseatedEntry[]> {
  const { rows } = await db.query<Record<string, unknown> & { reason: string }>(
    `SELECT u.reason, e.* FROM unseated u JOIN employees e ON e.id = u.employee_id
      WHERE u.office_id = $1 AND u.date = $2 ORDER BY lower(e.display_name)`,
    [officeId, date],
  );
  return rows.map((r) => ({
    employee: toEmployee(toPerson(r as unknown as Parameters<typeof toPerson>[0]), officeId),
    reason: r.reason as UnmatchedReason,
  }));
}

export async function unseatedReason(
  db: Queryable,
  employeeId: string,
  date: string,
): Promise<UnmatchedReason | null> {
  const { rows } = await db.query<{ reason: string }>(
    'SELECT reason FROM unseated WHERE employee_id = $1 AND date = $2',
    [employeeId, date],
  );
  return (rows[0]?.reason as UnmatchedReason | undefined) ?? null;
}

export async function addUnseated(
  db: Queryable,
  entry: { officeId: string; date: string; employeeId: string; reason: UnmatchedReason },
): Promise<void> {
  await db.query(
    `INSERT INTO unseated (office_id, date, employee_id, reason) VALUES ($1, $2, $3, $4)
     ON CONFLICT (office_id, date, employee_id) DO UPDATE SET reason = EXCLUDED.reason`,
    [entry.officeId, entry.date, entry.employeeId, entry.reason],
  );
}

export async function removeUnseated(
  db: Queryable,
  employeeId: string,
  date: string,
): Promise<void> {
  await db.query('DELETE FROM unseated WHERE employee_id = $1 AND date = $2', [employeeId, date]);
}

/**
 * Who has eaten with whom, for the novelty score and the no-repeat rule.
 * Cancelled tables and people who said they would not come did not share a
 * lunch, so they do not count as having met.
 */
export async function pastMatches(db: Queryable, excludingDate?: string): Promise<PastMatch[]> {
  const { rows } = await db.query<{ date: string; members: string[] }>(
    `SELECT t.date, array_agg(s.employee_id ORDER BY s.seat) AS members
       FROM lunch_tables t JOIN table_seats s ON s.table_id = t.id
      WHERE NOT t.cancelled AND s.rsvp <> 'declined'
        AND ($1::date IS NULL OR t.date <> $1)
        AND t.date >= current_date - 400
      GROUP BY t.id, t.date`,
    [excludingDate ?? null],
  );
  return rows.map((r) => ({ date: r.date, memberIds: r.members }));
}

/** Whether a day has been planned at an office, whatever the plan turned out to be. */
export async function dayPlanned(db: Queryable, officeId: string, date: string): Promise<boolean> {
  const { rows } = await db.query(
    `SELECT 1 FROM job_runs WHERE kind = 'match' AND office_id = $1 AND run_key = $2
       AND status = 'done' LIMIT 1`,
    [officeId, date],
  );
  return rows.length > 0;
}

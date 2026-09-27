import type { Queryable } from '../db';
import { isoWeekday } from '../lib/zoned';
import type { LunchRequest, RequestSource, Weekday, WeeklyPattern } from './types';

interface RequestRow extends Record<string, unknown> {
  employee_id: string;
  date: string;
  office_id: string;
  slot: string | null;
  source: string;
}

function toRequest(row: RequestRow): LunchRequest {
  return {
    employeeId: row.employee_id,
    date: row.date,
    officeId: row.office_id,
    slot: row.slot,
    source: row.source as RequestSource,
  };
}

/** Somebody's own request for a day, if they made one (not a weekly one). */
export async function getRequest(
  db: Queryable,
  employeeId: string,
  date: string,
): Promise<LunchRequest | null> {
  const { rows } = await db.query<RequestRow>(
    'SELECT * FROM lunch_requests WHERE employee_id = $1 AND date = $2',
    [employeeId, date],
  );
  return rows[0] ? toRequest(rows[0]) : null;
}

/** Asking for a day undoes having skipped it. */
export async function setRequest(db: Queryable, request: LunchRequest): Promise<void> {
  await db.query(
    `INSERT INTO lunch_requests (employee_id, date, office_id, slot, source)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (employee_id, date) DO UPDATE
       SET office_id = EXCLUDED.office_id, slot = EXCLUDED.slot, source = EXCLUDED.source`,
    [request.employeeId, request.date, request.officeId, request.slot, request.source],
  );
  await db.query('DELETE FROM request_skips WHERE employee_id = $1 AND date = $2', [
    request.employeeId,
    request.date,
  ]);
}

/**
 * Not coming that day. Recorded as a skip as well, so a weekly pattern does not
 * put the day straight back.
 */
export async function cancelRequest(
  db: Queryable,
  employeeId: string,
  date: string,
): Promise<void> {
  await db.query('DELETE FROM lunch_requests WHERE employee_id = $1 AND date = $2', [
    employeeId,
    date,
  ]);
  await db.query(
    'INSERT INTO request_skips (employee_id, date) VALUES ($1, $2) ON CONFLICT DO NOTHING',
    [employeeId, date],
  );
}

export async function getPattern(db: Queryable, employeeId: string): Promise<WeeklyPattern | null> {
  const { rows } = await db.query<{ employee_id: string; weekdays: number[]; slot: string | null }>(
    'SELECT employee_id, weekdays, slot FROM weekly_patterns WHERE employee_id = $1',
    [employeeId],
  );
  const row = rows[0];
  return row
    ? { employeeId: row.employee_id, weekdays: row.weekdays as Weekday[], slot: row.slot }
    : null;
}

/**
 * Saves somebody's weekly days.
 *
 * A weekday newly added to the pattern is a fresh "every Tuesday", so any
 * skip already recorded for a coming Tuesday goes: it came from dropping a
 * one-off request before there was a pattern, and left in place it would quietly
 * cancel the first week of the new habit. Skips on weekdays that were already
 * in the pattern are single weeks the person deliberately skipped, and stay.
 */
export async function setPattern(db: Queryable, pattern: WeeklyPattern): Promise<void> {
  const previous = await getPattern(db, pattern.employeeId);
  const added = pattern.weekdays.filter((d) => !previous?.weekdays.includes(d));
  if (added.length > 0) {
    await db.query(
      `DELETE FROM request_skips
        WHERE employee_id = $1 AND date >= current_date - 1
          AND extract(isodow FROM date)::int = ANY($2::int[])`,
      [pattern.employeeId, added],
    );
  }

  if (pattern.weekdays.length === 0) {
    await db.query('DELETE FROM weekly_patterns WHERE employee_id = $1', [pattern.employeeId]);
    return;
  }
  await db.query(
    `INSERT INTO weekly_patterns (employee_id, weekdays, slot) VALUES ($1, $2, $3)
     ON CONFLICT (employee_id) DO UPDATE
       SET weekdays = EXCLUDED.weekdays, slot = EXCLUDED.slot, updated_at = now()`,
    [pattern.employeeId, [...new Set(pattern.weekdays)].sort(), pattern.slot],
  );
}

export interface DayIntent {
  date: string;
  /** What the person will do that day, as it stands. */
  request: LunchRequest | null;
  /** They skipped a day their weekly pattern would have asked for. */
  skipped: boolean;
}

/**
 * What somebody has asked for over a range of days: their own requests, their
 * weekly pattern where they have not said otherwise, and the days they skipped.
 */
export async function intentsFor(
  db: Queryable,
  employee: { id: string; officeId: string | null },
  dates: readonly string[],
): Promise<Map<string, DayIntent>> {
  const result = new Map<string, DayIntent>();
  if (dates.length === 0) return result;

  const [explicit, skips, pattern] = await Promise.all([
    db.query<RequestRow>(
      'SELECT * FROM lunch_requests WHERE employee_id = $1 AND date = ANY($2::date[])',
      [employee.id, [...dates]],
    ),
    db.query<{ date: string }>(
      'SELECT date FROM request_skips WHERE employee_id = $1 AND date = ANY($2::date[])',
      [employee.id, [...dates]],
    ),
    getPattern(db, employee.id),
  ]);

  const byDate = new Map(explicit.rows.map((r) => [r.date, toRequest(r)]));
  const skipped = new Set(skips.rows.map((r) => r.date));

  for (const date of dates) {
    const own = byDate.get(date) ?? null;
    const weekly =
      !own &&
      !skipped.has(date) &&
      pattern !== null &&
      employee.officeId !== null &&
      pattern.weekdays.includes(isoWeekday(date))
        ? {
            employeeId: employee.id,
            date,
            officeId: employee.officeId,
            slot: pattern.slot,
            source: 'weekly' as const,
          }
        : null;
    result.set(date, { date, request: own ?? weekly, skipped: skipped.has(date) });
  }
  return result;
}

/**
 * Everybody who wants lunch at this office on this day: requests made for it,
 * and weekly patterns of people based there who have not said otherwise.
 * Only people who could actually be seated count.
 */
export async function requestsForDay(
  db: Queryable,
  officeId: string,
  date: string,
): Promise<LunchRequest[]> {
  const { rows } = await db.query<RequestRow>(
    `SELECT r.employee_id, r.date, r.office_id, r.slot, r.source
       FROM lunch_requests r JOIN employees e ON e.id = r.employee_id
      WHERE r.office_id = $1 AND r.date = $2 AND e.active AND e.onboarded_at IS NOT NULL
     UNION ALL
     SELECT p.employee_id, $2::date, e.office_id, p.slot, 'weekly'
       FROM weekly_patterns p JOIN employees e ON e.id = p.employee_id
      WHERE e.office_id = $1 AND e.active AND e.onboarded_at IS NOT NULL
        AND $3 = ANY (p.weekdays)
        AND NOT EXISTS (SELECT 1 FROM lunch_requests r2
                         WHERE r2.employee_id = p.employee_id AND r2.date = $2)
        AND NOT EXISTS (SELECT 1 FROM request_skips s
                         WHERE s.employee_id = p.employee_id AND s.date = $2)`,
    [officeId, date, isoWeekday(date)],
  );
  return rows.map(toRequest);
}

/**
 * Writes the weekly requests for a day as real rows, when the day is planned.
 * From then on the day is a list of people, not a rule, and a pattern changed
 * afterwards does not rewrite a lunch that is already arranged.
 */
export async function materialiseWeekly(
  db: Queryable,
  requests: readonly LunchRequest[],
): Promise<void> {
  for (const request of requests) {
    if (request.source !== 'weekly') continue;
    await db.query(
      `INSERT INTO lunch_requests (employee_id, date, office_id, slot, source)
       VALUES ($1, $2, $3, $4, 'weekly') ON CONFLICT (employee_id, date) DO NOTHING`,
      [request.employeeId, request.date, request.officeId, request.slot],
    );
  }
}

/** How many have asked, per day, for the console. */
export async function countRequests(
  db: Queryable,
  officeId: string,
  dates: readonly string[],
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  for (const date of dates) {
    counts.set(date, (await requestsForDay(db, officeId, date)).length);
  }
  return counts;
}

/** Who has had lunch through Sofra recently, for the evening reminder's audience. */
export async function recentDiners(
  db: Queryable,
  officeId: string,
  sinceDate: string,
): Promise<Set<string>> {
  const { rows } = await db.query<{ employee_id: string }>(
    `SELECT DISTINCT employee_id FROM lunch_requests WHERE office_id = $1 AND date >= $2`,
    [officeId, sinceDate],
  );
  return new Set(rows.map((r) => r.employee_id));
}

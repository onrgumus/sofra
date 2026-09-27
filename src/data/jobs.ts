import type { Queryable } from '../db';
import type { JobKind, JobRun, JobStatus } from './types';

interface JobRow extends Record<string, unknown> {
  id: number;
  kind: string;
  office_id: string | null;
  run_key: string;
  trigger: string;
  status: string;
  attempts: number;
  started_at: Date;
  finished_at: Date | null;
  summary: Record<string, unknown>;
  error: string | null;
}

function toRun(row: JobRow): JobRun {
  return {
    id: row.id,
    kind: row.kind as JobKind,
    officeId: row.office_id,
    runKey: row.run_key,
    trigger: row.trigger as JobRun['trigger'],
    status: row.status as JobStatus,
    attempts: row.attempts,
    startedAt: row.started_at.toISOString(),
    finishedAt: row.finished_at?.toISOString() ?? null,
    summary: row.summary,
    error: row.error,
  };
}

/** A failed scheduled job is tried again on later ticks, up to this many times. */
export const MAX_ATTEMPTS = 3;
/** A job still "running" after this long died with its process; it may be reclaimed. */
const STALE_MINUTES = 10;

/**
 * Claims a scheduled job, or finds it already claimed.
 *
 * The insert is the check. Two ticks racing each other, a platform retry, a
 * second scheduler somebody added: exactly one of them gets a row back, and
 * that one does the work. The others see the job exists and move on, which is
 * what stops a building being mailed twice. A failed job is reclaimable a few
 * times; a crashed one after it has gone quiet.
 */
export async function claimScheduled(
  db: Queryable,
  job: { kind: JobKind; officeId: string | null; runKey: string },
): Promise<number | null> {
  const dedupeKey = `${job.kind}:${job.officeId ?? '*'}:${job.runKey}`;
  const { rows } = await db.query<{ id: number }>(
    `INSERT INTO job_runs (kind, office_id, run_key, dedupe_key, trigger, status)
     VALUES ($1, $2, $3, $4, 'schedule', 'running')
     ON CONFLICT (dedupe_key) DO UPDATE
       SET status = 'running', attempts = job_runs.attempts + 1, started_at = now(),
           finished_at = NULL, error = NULL
       WHERE (job_runs.status = 'failed' AND job_runs.attempts < $5)
          OR (job_runs.status = 'running'
              AND job_runs.started_at < now() - make_interval(mins => $6))
     RETURNING id`,
    [job.kind, job.officeId, job.runKey, dedupeKey, MAX_ATTEMPTS, STALE_MINUTES],
  );
  return rows[0]?.id ?? null;
}

/** A run somebody asked for in the console. Recorded, never deduplicated. */
export async function startManual(
  db: Queryable,
  job: { kind: JobKind; officeId: string | null; runKey: string },
): Promise<number> {
  const { rows } = await db.query<{ id: number }>(
    `INSERT INTO job_runs (kind, office_id, run_key, trigger, status)
     VALUES ($1, $2, $3, 'manual', 'running') RETURNING id`,
    [job.kind, job.officeId, job.runKey],
  );
  return rows[0]!.id;
}

export async function finishRun(
  db: Queryable,
  id: number,
  outcome: { status: Exclude<JobStatus, 'running'>; summary?: object; error?: string },
): Promise<void> {
  await db.query(
    `UPDATE job_runs SET status = $2, summary = $3, error = $4, finished_at = now() WHERE id = $1`,
    [id, outcome.status, JSON.stringify(outcome.summary ?? {}), outcome.error ?? null],
  );
}

/** Records something that was due and deliberately not done, e.g. too late to be useful. */
export async function recordSkipped(
  db: Queryable,
  job: { kind: JobKind; officeId: string | null; runKey: string; reason: string },
): Promise<void> {
  const dedupeKey = `${job.kind}:${job.officeId ?? '*'}:${job.runKey}`;
  await db.query(
    `INSERT INTO job_runs (kind, office_id, run_key, dedupe_key, trigger, status, finished_at, summary)
     VALUES ($1, $2, $3, $4, 'schedule', 'skipped', now(), $5)
     ON CONFLICT (dedupe_key) DO NOTHING`,
    [job.kind, job.officeId, job.runKey, dedupeKey, JSON.stringify({ reason: job.reason })],
  );
}

export async function scheduledRunExists(
  db: Queryable,
  job: { kind: JobKind; officeId: string | null; runKey: string },
): Promise<boolean> {
  const { rows } = await db.query('SELECT 1 FROM job_runs WHERE dedupe_key = $1', [
    `${job.kind}:${job.officeId ?? '*'}:${job.runKey}`,
  ]);
  return rows.length > 0;
}

export async function listRuns(
  db: Queryable,
  filter: { officeId?: string | null; officeIds?: readonly string[]; limit?: number } = {},
): Promise<JobRun[]> {
  const { rows } = await db.query<JobRow>(
    `SELECT * FROM job_runs
      WHERE ($1::text IS NULL OR office_id = $1)
        AND ($2::text[] IS NULL OR office_id = ANY($2))
      ORDER BY started_at DESC, id DESC LIMIT $3`,
    [filter.officeId ?? null, filter.officeIds ? [...filter.officeIds] : null, filter.limit ?? 100],
  );
  return rows.map(toRun);
}

export async function lastRun(
  db: Queryable,
  job: { kind: JobKind; officeId: string | null; runKey: string },
): Promise<JobRun | null> {
  const { rows } = await db.query<JobRow>(
    `SELECT * FROM job_runs WHERE kind = $1 AND office_id IS NOT DISTINCT FROM $2 AND run_key = $3
      ORDER BY started_at DESC, id DESC LIMIT 1`,
    [job.kind, job.officeId, job.runKey],
  );
  return rows[0] ? toRun(rows[0]) : null;
}

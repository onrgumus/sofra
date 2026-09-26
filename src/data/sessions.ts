import type { Queryable } from '../db';
import type { Session, SignInMethod } from './types';

interface SessionRow extends Record<string, unknown> {
  id_hash: string;
  employee_id: string;
  method: string;
  created_at: Date;
  authenticated_at: Date;
  last_seen_at: Date;
  expires_at: Date;
  user_agent: string;
  ip: string;
}

function toSession(row: SessionRow): Session {
  return {
    idHash: row.id_hash,
    employeeId: row.employee_id,
    method: row.method as SignInMethod,
    createdAt: row.created_at.toISOString(),
    authenticatedAt: row.authenticated_at.toISOString(),
    lastSeenAt: row.last_seen_at.toISOString(),
    expiresAt: row.expires_at.toISOString(),
    userAgent: row.user_agent,
    ip: row.ip,
  };
}

export async function insertSession(
  db: Queryable,
  session: {
    idHash: string;
    employeeId: string;
    method: SignInMethod;
    expiresAt: Date;
    userAgent: string;
    ip: string;
  },
): Promise<void> {
  await db.query(
    `INSERT INTO sessions (id_hash, employee_id, method, expires_at, user_agent, ip)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      session.idHash,
      session.employeeId,
      session.method,
      session.expiresAt,
      session.userAgent.slice(0, 300),
      session.ip.slice(0, 64),
    ],
  );
}

/** A live session: not expired, and its person still active. */
export async function findLiveSession(db: Queryable, idHash: string): Promise<Session | null> {
  const { rows } = await db.query<SessionRow>(
    `SELECT s.* FROM sessions s JOIN employees e ON e.id = s.employee_id
     WHERE s.id_hash = $1 AND s.expires_at > now() AND e.active`,
    [idHash],
  );
  return rows[0] ? toSession(rows[0]) : null;
}

/**
 * Records that the session was used. At most every five minutes, because a
 * write per page view is a write per page view.
 */
export async function touchSession(db: Queryable, idHash: string): Promise<void> {
  await db.query(
    `UPDATE sessions SET last_seen_at = now()
     WHERE id_hash = $1 AND last_seen_at < now() - interval '5 minutes'`,
    [idHash],
  );
}

export async function deleteSession(db: Queryable, idHash: string): Promise<void> {
  await db.query('DELETE FROM sessions WHERE id_hash = $1', [idHash]);
}

/** Every session somebody has, everywhere: for deactivation and "sign out everywhere". */
export async function deleteSessionsOf(
  db: Queryable,
  employeeId: string,
  exceptIdHash?: string,
): Promise<number> {
  const { rowCount } = await db.query(
    'DELETE FROM sessions WHERE employee_id = $1 AND id_hash IS DISTINCT FROM $2',
    [employeeId, exceptIdHash ?? null],
  );
  return rowCount ?? 0;
}

export async function listSessionsOf(db: Queryable, employeeId: string): Promise<Session[]> {
  const { rows } = await db.query<SessionRow>(
    'SELECT * FROM sessions WHERE employee_id = $1 AND expires_at > now() ORDER BY last_seen_at DESC',
    [employeeId],
  );
  return rows.map(toSession);
}

export async function pruneExpiredSessions(db: Queryable): Promise<void> {
  await db.query('DELETE FROM sessions WHERE expires_at < now()');
  await db.query("DELETE FROM login_tokens WHERE expires_at < now() - interval '1 day'");
  await db.query("DELETE FROM rate_limit_events WHERE at < now() - interval '1 day'");
}

// --- emailed sign-in links ---------------------------------------------------

export async function insertLoginToken(
  db: Queryable,
  token: { tokenHash: string; email: string; nextPath: string; expiresAt: Date; ip: string },
): Promise<void> {
  await db.query(
    `INSERT INTO login_tokens (token_hash, email, next_path, expires_at, ip)
     VALUES ($1, $2, $3, $4, $5)`,
    [token.tokenHash, token.email, token.nextPath, token.expiresAt, token.ip.slice(0, 64)],
  );
}

export interface PendingLogin {
  email: string;
  nextPath: string;
  expiresAt: string;
}

/** A link that could still be used, without using it: for the confirmation page. */
export async function peekLoginToken(
  db: Queryable,
  tokenHash: string,
): Promise<PendingLogin | null> {
  const { rows } = await db.query<{ email: string; next_path: string; expires_at: Date }>(
    `SELECT email, next_path, expires_at FROM login_tokens
     WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()`,
    [tokenHash],
  );
  const row = rows[0];
  return row
    ? { email: row.email, nextPath: row.next_path, expiresAt: row.expires_at.toISOString() }
    : null;
}

/**
 * Uses a link, once. The update is the check: two clicks racing each other
 * cannot both see it unused, because only one of them gets the row back.
 */
export async function consumeLoginToken(
  db: Queryable,
  tokenHash: string,
): Promise<PendingLogin | null> {
  const { rows } = await db.query<{ email: string; next_path: string; expires_at: Date }>(
    `UPDATE login_tokens SET used_at = now()
     WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()
     RETURNING email, next_path, expires_at`,
    [tokenHash],
  );
  const row = rows[0];
  return row
    ? { email: row.email, nextPath: row.next_path, expiresAt: row.expires_at.toISOString() }
    : null;
}

/** An address gets one live link at a time: asking again retires the old one. */
export async function retireLoginTokens(db: Queryable, email: string): Promise<void> {
  await db.query('UPDATE login_tokens SET used_at = now() WHERE email = $1 AND used_at IS NULL', [
    email,
  ]);
}

// --- rate limiting -----------------------------------------------------------

/**
 * Counts an attempt against a key and says whether it is still within the
 * limit. In the database, because a counter in memory is per instance and
 * forgets on every restart, which on a serverless platform is no limit at all.
 */
export async function hitRateLimit(
  db: Queryable,
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<boolean> {
  await db.query(
    'DELETE FROM rate_limit_events WHERE at < now() - make_interval(secs => $1) AND key = $2',
    [windowSeconds, key],
  );
  const { rows } = await db.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM rate_limit_events
     WHERE key = $1 AND at >= now() - make_interval(secs => $2)`,
    [key, windowSeconds],
  );
  if ((rows[0]?.n ?? 0) >= limit) return false;
  await db.query('INSERT INTO rate_limit_events (key) VALUES ($1)', [key]);
  return true;
}

import type { Queryable } from '../db';
import type { AdminGrant, AuditEntry } from './types';

interface GrantRow extends Record<string, unknown> {
  id: number;
  employee_id: string;
  office_id: string | null;
  granted_by: string;
  granted_at: Date;
}

function toGrant(row: GrantRow): AdminGrant {
  return {
    id: row.id,
    employeeId: row.employee_id,
    officeId: row.office_id,
    grantedBy: row.granted_by,
    grantedAt: row.granted_at.toISOString(),
  };
}

export async function listGrants(db: Queryable): Promise<AdminGrant[]> {
  const { rows } = await db.query<GrantRow>('SELECT * FROM admin_grants ORDER BY granted_at');
  return rows.map(toGrant);
}

export async function grantsOf(db: Queryable, employeeId: string): Promise<AdminGrant[]> {
  const { rows } = await db.query<GrantRow>(
    'SELECT * FROM admin_grants WHERE employee_id = $1 ORDER BY granted_at',
    [employeeId],
  );
  return rows.map(toGrant);
}

export async function addGrant(
  db: Queryable,
  grant: { employeeId: string; officeId: string | null; grantedBy: string },
): Promise<void> {
  await db.query(
    `INSERT INTO admin_grants (employee_id, office_id, granted_by) VALUES ($1, $2, $3)
     ON CONFLICT (employee_id, (coalesce(office_id, ''))) DO NOTHING`,
    [grant.employeeId, grant.officeId, grant.grantedBy],
  );
}

export async function removeGrant(db: Queryable, grantId: number): Promise<AdminGrant | null> {
  const { rows } = await db.query<GrantRow>('DELETE FROM admin_grants WHERE id = $1 RETURNING *', [
    grantId,
  ]);
  return rows[0] ? toGrant(rows[0]) : null;
}

export async function recordAudit(
  db: Queryable,
  entry: {
    actorId: string | null;
    actorEmail: string;
    action: string;
    target?: string;
    details?: Record<string, unknown>;
  },
): Promise<void> {
  await db.query(
    'INSERT INTO audit_log (actor_id, actor_email, action, target, details) VALUES ($1, $2, $3, $4, $5)',
    [
      entry.actorId,
      entry.actorEmail,
      entry.action,
      entry.target ?? '',
      JSON.stringify(entry.details ?? {}),
    ],
  );
}

export async function listAudit(
  db: Queryable,
  options: { limit?: number; before?: number } = {},
): Promise<AuditEntry[]> {
  const { rows } = await db.query<{
    id: number;
    at: Date;
    actor_id: string | null;
    actor_email: string;
    action: string;
    target: string;
    details: Record<string, unknown>;
  }>(
    `SELECT * FROM audit_log WHERE ($1::bigint IS NULL OR id < $1)
     ORDER BY id DESC LIMIT $2`,
    [options.before ?? null, options.limit ?? 100],
  );
  return rows.map((r) => ({
    id: r.id,
    at: r.at.toISOString(),
    actorId: r.actor_id,
    actorEmail: r.actor_email,
    action: r.action,
    target: r.target,
    details: r.details,
  }));
}

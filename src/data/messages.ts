import type { Queryable } from '../db';
import type { OutboxMail } from './types';

// --- once-per-person-per-day messages -----------------------------------------

export async function listNotified(
  db: Queryable,
  kind: string,
  officeId: string,
  date: string,
): Promise<Set<string>> {
  const { rows } = await db.query<{ employee_id: string }>(
    'SELECT employee_id FROM notifications_sent WHERE kind = $1 AND office_id = $2 AND date = $3',
    [kind, officeId, date],
  );
  return new Set(rows.map((r) => r.employee_id));
}

/** Recorded after a send succeeds, so a failure is retried rather than counted. */
export async function recordNotified(
  db: Queryable,
  kind: string,
  officeId: string,
  date: string,
  employeeIds: readonly string[],
): Promise<void> {
  if (employeeIds.length === 0) return;
  await db.query(
    `INSERT INTO notifications_sent (kind, office_id, date, employee_id)
     SELECT $1, $2, $3, unnest($4::text[]) ON CONFLICT DO NOTHING`,
    [kind, officeId, date, [...employeeIds]],
  );
}

// --- the development outbox ---------------------------------------------------

export async function storeMail(
  db: Queryable,
  mail: Omit<OutboxMail, 'id' | 'createdAt'>,
): Promise<number> {
  const { rows } = await db.query<{ id: number }>(
    `INSERT INTO mail_outbox (sender, recipients, subject, text_body, html_body, attachments)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [
      mail.sender,
      mail.recipients,
      mail.subject,
      mail.text,
      mail.html,
      JSON.stringify(mail.attachments),
    ],
  );
  return rows[0]!.id;
}

interface OutboxRow extends Record<string, unknown> {
  id: number;
  created_at: Date;
  sender: string;
  recipients: string[];
  subject: string;
  text_body: string;
  html_body: string;
  attachments: OutboxMail['attachments'];
}

function toMail(row: OutboxRow): OutboxMail {
  return {
    id: row.id,
    createdAt: row.created_at.toISOString(),
    sender: row.sender,
    recipients: row.recipients,
    subject: row.subject,
    text: row.text_body,
    html: row.html_body,
    attachments: row.attachments,
  };
}

export async function listMail(
  db: Queryable,
  options: { recipient?: string; limit?: number } = {},
): Promise<OutboxMail[]> {
  const { rows } = await db.query<OutboxRow>(
    `SELECT * FROM mail_outbox WHERE ($1::text IS NULL OR $1 = ANY(recipients))
      ORDER BY id DESC LIMIT $2`,
    [options.recipient?.toLowerCase() ?? null, options.limit ?? 50],
  );
  return rows.map(toMail);
}

export async function getMail(db: Queryable, id: number): Promise<OutboxMail | null> {
  const { rows } = await db.query<OutboxRow>('SELECT * FROM mail_outbox WHERE id = $1', [id]);
  return rows[0] ? toMail(rows[0]) : null;
}

// --- Teams --------------------------------------------------------------------

export interface TeamsConversation {
  employeeId: string;
  conversationId: string;
  serviceUrl: string;
  tenantId: string;
}

export async function saveTeamsConversation(db: Queryable, ref: TeamsConversation): Promise<void> {
  await db.query(
    `INSERT INTO teams_conversations (employee_id, conversation_id, service_url, tenant_id)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (employee_id) DO UPDATE SET conversation_id = EXCLUDED.conversation_id,
       service_url = EXCLUDED.service_url, tenant_id = EXCLUDED.tenant_id, updated_at = now()`,
    [ref.employeeId, ref.conversationId, ref.serviceUrl, ref.tenantId],
  );
}

export async function getTeamsConversation(
  db: Queryable,
  employeeId: string,
): Promise<TeamsConversation | null> {
  const { rows } = await db.query<{
    employee_id: string;
    conversation_id: string;
    service_url: string;
    tenant_id: string;
  }>('SELECT * FROM teams_conversations WHERE employee_id = $1', [employeeId]);
  const row = rows[0];
  return row
    ? {
        employeeId: row.employee_id,
        conversationId: row.conversation_id,
        serviceUrl: row.service_url,
        tenantId: row.tenant_id,
      }
    : null;
}

// --- calendar hints -----------------------------------------------------------

export async function calendarFetchedAt(
  db: Queryable,
  employeeId: string,
  from: string,
  to: string,
): Promise<Date | null> {
  const { rows } = await db.query<{ fetched_at: Date }>(
    `SELECT fetched_at FROM calendar_fetches
      WHERE employee_id = $1 AND from_date <= $2 AND to_date >= $3`,
    [employeeId, from, to],
  );
  return rows[0]?.fetched_at ?? null;
}

export async function saveCalendarHints(
  db: Queryable,
  employeeId: string,
  range: { from: string; to: string },
  hints: readonly { date: string; officeId: string | null }[],
): Promise<void> {
  await db.query('DELETE FROM calendar_hints WHERE employee_id = $1 AND date BETWEEN $2 AND $3', [
    employeeId,
    range.from,
    range.to,
  ]);
  for (const hint of hints) {
    await db.query(
      `INSERT INTO calendar_hints (employee_id, date, office_id) VALUES ($1, $2, $3)
       ON CONFLICT (employee_id, date) DO UPDATE SET office_id = EXCLUDED.office_id`,
      [employeeId, hint.date, hint.officeId],
    );
  }
  await db.query(
    `INSERT INTO calendar_fetches (employee_id, from_date, to_date) VALUES ($1, $2, $3)
     ON CONFLICT (employee_id) DO UPDATE SET from_date = EXCLUDED.from_date,
       to_date = EXCLUDED.to_date, fetched_at = now()`,
    [employeeId, range.from, range.to],
  );
}

export async function calendarHints(
  db: Queryable,
  employeeId: string,
  dates: readonly string[],
): Promise<Map<string, string | null>> {
  const { rows } = await db.query<{ date: string; office_id: string | null }>(
    'SELECT date, office_id FROM calendar_hints WHERE employee_id = $1 AND date = ANY($2::date[])',
    [employeeId, [...dates]],
  );
  return new Map(rows.map((r) => [r.date, r.office_id]));
}

/** Everyone whose calendar says they will be at this office that day. */
export async function hintedFor(
  db: Queryable,
  officeId: string,
  date: string,
): Promise<Set<string>> {
  const { rows } = await db.query<{ employee_id: string }>(
    'SELECT employee_id FROM calendar_hints WHERE date = $1 AND (office_id = $2 OR office_id IS NULL)',
    [date, officeId],
  );
  return new Set(rows.map((r) => r.employee_id));
}

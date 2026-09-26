import type { Queryable } from '../db';
import type { Holiday, Office, Weekday } from './types';

interface OfficeRow extends Record<string, unknown> {
  id: string;
  name: string;
  address: string;
  meeting_point: string;
  time_zone: string;
  opens_at: string;
  match_lead_minutes: number;
  confirm_by: string;
  reminder_at: string;
  lunch_slots: string[];
  working_days: number[];
  min_table: number;
  max_table: number;
  location_keywords: string[];
  active: boolean;
}

function toOffice(row: OfficeRow): Office {
  return {
    id: row.id,
    name: row.name,
    address: row.address,
    meetingPoint: row.meeting_point,
    timeZone: row.time_zone,
    opensAt: row.opens_at,
    matchLeadMinutes: row.match_lead_minutes,
    confirmBy: row.confirm_by,
    reminderAt: row.reminder_at,
    lunchSlots: [...row.lunch_slots].sort(),
    workingDays: row.working_days as Weekday[],
    minTable: row.min_table,
    maxTable: row.max_table,
    locationKeywords: row.location_keywords,
    active: row.active,
  };
}

export async function listOffices(
  db: Queryable,
  options: { activeOnly?: boolean } = {},
): Promise<Office[]> {
  const { rows } = await db.query<OfficeRow>(
    `SELECT * FROM offices ${options.activeOnly ? 'WHERE active' : ''} ORDER BY lower(name)`,
  );
  return rows.map(toOffice);
}

export async function getOffice(db: Queryable, id: string): Promise<Office | null> {
  const { rows } = await db.query<OfficeRow>('SELECT * FROM offices WHERE id = $1', [id]);
  return rows[0] ? toOffice(rows[0]) : null;
}

function officeValues(office: Office): unknown[] {
  return [
    office.id,
    office.name,
    office.address,
    office.meetingPoint,
    office.timeZone,
    office.opensAt,
    office.matchLeadMinutes,
    office.confirmBy,
    office.reminderAt,
    office.lunchSlots,
    office.workingDays,
    office.minTable,
    office.maxTable,
    office.locationKeywords,
    office.active,
  ];
}

export async function createOffice(db: Queryable, office: Office): Promise<Office> {
  const { rows } = await db.query<OfficeRow>(
    `INSERT INTO offices (id, name, address, meeting_point, time_zone, opens_at,
       match_lead_minutes, confirm_by, reminder_at, lunch_slots, working_days, min_table,
       max_table, location_keywords, active)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
     RETURNING *`,
    officeValues(office),
  );
  return toOffice(rows[0]!);
}

/** Everything but the id, which other rows point at. */
export async function updateOffice(db: Queryable, office: Office): Promise<Office> {
  const { rows } = await db.query<OfficeRow>(
    `UPDATE offices SET name = $2, address = $3, meeting_point = $4, time_zone = $5,
       opens_at = $6, match_lead_minutes = $7, confirm_by = $8, reminder_at = $9,
       lunch_slots = $10, working_days = $11, min_table = $12, max_table = $13,
       location_keywords = $14, active = $15, updated_at = now()
     WHERE id = $1 RETURNING *`,
    officeValues(office),
  );
  if (!rows[0]) throw new Error(`No office ${office.id}`);
  return toOffice(rows[0]);
}

export async function listHolidays(
  db: Queryable,
  officeId: string,
  range: { from?: string; to?: string } = {},
): Promise<Holiday[]> {
  const { rows } = await db.query<{ office_id: string; date: string; name: string }>(
    `SELECT office_id, date, name FROM office_holidays
     WHERE office_id = $1 AND ($2::date IS NULL OR date >= $2) AND ($3::date IS NULL OR date <= $3)
     ORDER BY date`,
    [officeId, range.from ?? null, range.to ?? null],
  );
  return rows.map((r) => ({ officeId: r.office_id, date: r.date, name: r.name }));
}

export async function addHoliday(db: Queryable, holiday: Holiday): Promise<void> {
  await db.query(
    `INSERT INTO office_holidays (office_id, date, name) VALUES ($1, $2, $3)
     ON CONFLICT (office_id, date) DO UPDATE SET name = EXCLUDED.name`,
    [holiday.officeId, holiday.date, holiday.name],
  );
}

export async function removeHoliday(db: Queryable, officeId: string, date: string): Promise<void> {
  await db.query('DELETE FROM office_holidays WHERE office_id = $1 AND date = $2', [
    officeId,
    date,
  ]);
}

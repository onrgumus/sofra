import type { Employee } from '../core/types';
import type { Db } from '../db';
import type { Directory } from '../directory/types';
import { ENTRA } from '../directory/identity';
import {
  applyDirectoryRecord,
  createPerson,
  findPerson,
  listBySource,
  setActive,
} from '../data/people';
import { deleteSessionsOf } from '../data/sessions';
import { addDepartment } from '../data/settings';
import type { EmployeeSource } from '../data/types';

export interface SyncSummary {
  read: number;
  created: number;
  updated: number;
  deactivated: number;
  /** Set when leavers were not deactivated because the read looked wrong. */
  heldBack?: string;
}

/**
 * Brings the company's people in from its directory, and takes out the ones
 * who have left.
 *
 * New people arrive without a finished profile: they confirm their office and
 * the rest on first sign-in, with what the directory knew already filled in.
 * People already here have their name, title, department and team updated;
 * what they chose themselves is left alone.
 *
 * Somebody the directory no longer has is deactivated and signed out
 * everywhere, which is how a leaver stops being able to get in without anybody
 * remembering to do it. Unless the read came back suspiciously small: an
 * export truncated by an outage must not sign out half the company.
 */
export async function syncDirectory(
  db: Db,
  directory: Directory,
  source: Extract<EmployeeSource, 'entra' | 'csv'>,
  now = new Date(),
): Promise<SyncSummary> {
  const read = await directory.listEmployees();
  const summary: SyncSummary = { read: read.length, created: 0, updated: 0, deactivated: 0 };
  const seen = new Set<string>();

  for (const employee of read) {
    const department = employee.department ? await addDepartment(db, employee.department) : null;
    const record = {
      displayName: employee.displayName,
      title: employee.title === employee.department ? '' : employee.title,
      department,
      team: teamOf(employee),
      aliases: employee.aliases ?? [],
      entraObjectId: employee.externalIds?.[ENTRA] ?? null,
      officeId: employee.officeId || null,
      seniority: employee.seniority,
      startedOn: employee.tenureMonths > 0 ? monthsAgo(employee.tenureMonths, now) : null,
    };

    const existing = await findPerson(db, {
      entraObjectId: record.entraObjectId,
      addresses: [employee.email, ...(employee.aliases ?? [])],
    });

    if (existing) {
      await applyDirectoryRecord(db, existing.id, record);
      seen.add(existing.id);
      summary.updated++;
      continue;
    }

    const created = await createPerson(db, {
      email: employee.email,
      source,
      displayName: record.displayName,
      title: record.title,
      department: record.department,
      team: record.team,
      seniority: record.seniority,
      officeId: record.officeId,
      languages: employee.languages,
      interests: employee.interests,
      startedOn: record.startedOn,
      aliases: record.aliases,
      entraObjectId: record.entraObjectId,
    });
    seen.add(created.id);
    summary.created++;
  }

  const previously = await listBySource(db, source);
  const leaving = previously.filter((p) => !seen.has(p.id));
  if (previously.length > 10 && leaving.length > previously.length / 2) {
    summary.heldBack = `${leaving.length} of ${previously.length} would have been deactivated`;
    return summary;
  }
  for (const person of leaving) {
    await setActive(db, person.id, false);
    await deleteSessionsOf(db, person.id);
    summary.deactivated++;
  }
  return summary;
}

/** The directory's team key carries its department; stored, the department is its own field. */
function teamOf(employee: Employee): string {
  const prefix = `${employee.department}/`;
  if (employee.team === employee.department) return '';
  return employee.team.startsWith(prefix) ? employee.team.slice(prefix.length) : employee.team;
}

function monthsAgo(months: number, now: Date): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - months, 1));
  return d.toISOString().slice(0, 10);
}

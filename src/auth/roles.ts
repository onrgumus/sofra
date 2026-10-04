import type { Queryable } from '../db';
import { grantsOf } from '../data/admin';
import type { Person } from '../data/types';
import { envOptional } from '../lib/env';
import { demoOpen } from './demo';

/**
 * What somebody may administer. Two levels:
 *
 *   - every office: company settings, all offices, all people, who else is an admin
 *   - some offices: those offices' timetables, holidays, tables and runs, nothing else
 *
 * The console shows every table and every reply for an office, and its buttons
 * re-plan the day and mail the building, so being signed in is not enough.
 */
export interface AdminRole {
  everyOffice: boolean;
  officeIds: string[];
  /** Named in SOFRA_ADMINS: the way back in, which the UI cannot take away. */
  bootstrap: boolean;
  /**
   * May look and may not change: a guest in a public demo, who is shown the
   * console because it is half the product and can alter nothing in it.
   */
  readOnly: boolean;
}

/**
 * The people who administer a brand new deployment, before anybody has been
 * granted anything, and the way back in if every grant is removed. Addresses,
 * because a new deployment has no employee ids yet.
 */
export function bootstrapAdminEmails(): string[] {
  return (envOptional('SOFRA_ADMINS') ?? '')
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.includes('@'));
}

export async function roleOf(db: Queryable, person: Person | null): Promise<AdminRole | null> {
  if (!person || !person.active) return null;

  const bootstrap = bootstrapAdminEmails().includes(person.email);
  const grants = await grantsOf(db, person.id);
  const everyOffice = bootstrap || grants.some((g) => g.officeId === null);
  const officeIds = [...new Set(grants.flatMap((g) => (g.officeId ? [g.officeId] : [])))];

  if (!everyOffice && officeIds.length === 0) {
    return (await demoOpen(db))
      ? { everyOffice: true, officeIds: [], bootstrap: false, readOnly: true }
      : null;
  }
  return { everyOffice, officeIds, bootstrap, readOnly: false };
}

export function canManageOffice(role: AdminRole | null, officeId: string): boolean {
  return role !== null && (role.everyOffice || role.officeIds.includes(officeId));
}

/** The offices a role may see, from the full list. */
export function visibleOffices<T extends { id: string }>(
  role: AdminRole,
  offices: readonly T[],
): T[] {
  return role.everyOffice ? [...offices] : offices.filter((o) => role.officeIds.includes(o.id));
}

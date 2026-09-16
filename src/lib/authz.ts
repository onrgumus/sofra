import type { Employee } from '../core/types';
import type { Store } from '../store/types';
import { envOptional } from './env';

/**
 * Who is allowed to do more than eat lunch.
 *
 * The matching console shows every table, every name and every reply for a
 * whole office, and its buttons re-plan the day and mail the building. Being
 * signed in is not a good enough reason to have that.
 *
 * Two ways in. SOFRA_ADMINS is the bootstrap: the people who can open the
 * console on a brand new deployment, before anybody has been granted anything,
 * and the way back in if the last admin in the database is removed by accident.
 * Everything after that is rows, because needing a redeploy to give a colleague
 * the console is not an administration story anybody would accept.
 */
export function bootstrapAdmins(): string[] {
  const configured = envOptional('SOFRA_ADMINS');
  if (!configured) return [];

  return configured
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry !== '');
}

/** True for someone named in the environment, who cannot be revoked from the UI. */
export function isBootstrapAdmin(employee: Employee | undefined): boolean {
  if (!employee) return false;

  const allowed = bootstrapAdmins();
  return (
    allowed.includes(employee.id.toLowerCase()) || allowed.includes(employee.email.toLowerCase())
  );
}

export async function isAdmin(store: Store, employee: Employee | undefined): Promise<boolean> {
  if (!employee) return false;
  if (isBootstrapAdmin(employee)) return true;

  return (await store.listAdmins()).some((grant) => grant.employeeId === employee.id);
}

/**
 * Whether anyone may act as anyone.
 *
 * The account switcher is the point of a public demo and impersonation in a
 * company: sign in, become a colleague, read their lunches, answer for them.
 * Off unless asked for, and never on by accident in production.
 */
export function demoModeEnabled(): boolean {
  if (process.env.NODE_ENV === 'production' && envOptional('SOFRA_DEMO_MODE') !== 'true') {
    return false;
  }
  return envOptional('SOFRA_DEMO_MODE') !== 'false';
}

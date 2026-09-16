import type { Employee } from '../core/types';
import { envOptional } from './env';

/**
 * Who is allowed to do more than eat lunch.
 *
 * The matching console shows every table, every person and every reply for a
 * whole office, and its buttons re-plan the day and mail the building. Being
 * signed in is not a good enough reason to have that, so it is a named list
 * rather than a default.
 *
 * SOFRA_ADMINS holds a comma-separated list of employee ids or email addresses.
 * Empty means nobody, which is the right way to fail: an unconfigured
 * deployment should refuse the console, not hand it to the first person who
 * signs in.
 */
export function isAdmin(employee: Employee | undefined): boolean {
  if (!employee) return false;

  const configured = envOptional('SOFRA_ADMINS');
  if (!configured) return false;

  const allowed = configured
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry !== '');

  return (
    allowed.includes(employee.id.toLowerCase()) || allowed.includes(employee.email.toLowerCase())
  );
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

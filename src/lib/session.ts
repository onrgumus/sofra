import { cookies } from 'next/headers';
import type { Store } from '../store/types';

/**
 * Who the current visitor is acting as.
 *
 * The demo has no sign-in, but "who am I" still has to be per-visitor: holding
 * it in one server-side variable meant two people opening the same link would
 * switch each other's account mid-click. It lives in a cookie instead, so the
 * company data stays shared — it is one company — while the session does not.
 *
 * Replacing this file is the whole of adding real authentication.
 */
export const EMPLOYEE_COOKIE = 'sofra_employee';
export const SEAT_COOKIE = 'sofra_seat';

const YEAR_IN_SECONDS = 60 * 60 * 24 * 365;

export async function currentEmployeeId(store: Store): Promise<string> {
  const jar = await cookies();

  const chosen = jar.get(EMPLOYEE_COOKIE)?.value;
  if (chosen && store.getEmployee(chosen)) return chosen;

  // First visit: the middleware handed out a seat number, so two people opening
  // the demo land on different colleagues instead of fighting over one.
  const people = store.listEmployees();
  const seat = Number.parseInt(jar.get(SEAT_COOKIE)?.value ?? '', 10);
  const index = Number.isFinite(seat) ? Math.abs(seat) % people.length : 0;
  return people[index]!.id;
}

export async function setCurrentEmployeeId(employeeId: string): Promise<void> {
  const jar = await cookies();
  jar.set(EMPLOYEE_COOKIE, employeeId, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: YEAR_IN_SECONDS,
  });
}

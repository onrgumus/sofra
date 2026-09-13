import type { Employee } from '../core/types';
import type { Store } from './types';

/**
 * The account the demo signs you in as.
 *
 * A real person in the seeded company rather than a special case: he is in the
 * office on the same days as everyone else, goes into the same pool, and gets
 * seated by the same matcher. Nothing in the engine knows he is different.
 */
export const DEMO_USERNAME = 'onur';

export const FEATURED_EMPLOYEE: Employee = {
  id: 'onur',
  displayName: 'Onur GG',
  email: 'onur@example.com',
  title: 'AI Digital Transformation Manager',
  seniority: 'manager',
  department: 'Digital Transformation',
  team: 'Digital Transformation/AI',
  officeId: 'IST-HQ',
  languages: ['en', 'tr'],
  tenureMonths: 41,
  interests: ['running', 'chess', 'live music'],
};

/**
 * Someone other than the demo account, for visitors who would rather not share
 * one. A public link means several people clicking at once, and four of them
 * all acting as Onur GG would be ticking and unticking the same boxes.
 */
export async function pickRandomColleague(
  store: Store,
  random: () => number = Math.random,
): Promise<Employee> {
  const colleagues = (await store.listEmployees()).filter((e) => e.id !== FEATURED_EMPLOYEE.id);
  if (colleagues.length === 0) return FEATURED_EMPLOYEE;

  return colleagues[Math.floor(random() * colleagues.length)] ?? colleagues[0]!;
}

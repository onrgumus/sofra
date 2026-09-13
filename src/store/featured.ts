import type { Employee } from '../core/types';

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

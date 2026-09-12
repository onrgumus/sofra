import type { Employee, OptIn, Seniority } from '../src/core/types';

export function employee(id: string, overrides: Partial<Employee> = {}): Employee {
  return {
    id,
    displayName: `Person ${id}`,
    email: `${id}@example.com`,
    title: 'Specialist',
    seniority: 'mid' as Seniority,
    department: 'Engineering',
    team: 'Engineering/Platform',
    officeId: 'HQ',
    languages: ['en'],
    tenureMonths: 24,
    interests: [],
    ...overrides,
  };
}

export function optIn(employeeId: string, overrides: Partial<OptIn> = {}): OptIn {
  return {
    employeeId,
    date: '2026-09-16',
    officeId: 'HQ',
    slot: '12:00',
    ...overrides,
  };
}

/** N people, each in their own team and department, so nothing blocks matching. */
export function distinctPeople(count: number): Employee[] {
  return Array.from({ length: count }, (_, i) =>
    employee(`e${i + 1}`, {
      department: `Dept${i % 7}`,
      team: `Team${i}`,
      seniority: (['intern', 'junior', 'mid', 'senior', 'lead', 'manager', 'director'] as const)[i % 7],
      tenureMonths: (i * 7) % 120,
    }),
  );
}

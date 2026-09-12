import { describe, expect, it } from 'vitest';
import { matchLunches } from '../src/core/matcher';
import { DEFAULT_CONFIG } from '../src/core/types';
import { distinctPeople, employee, optIn } from './helpers';

const DATE = '2026-09-16';

function run(
  employees: ReturnType<typeof distinctPeople>,
  optIns = employees.map((e) => optIn(e.id)),
  extra = {},
) {
  return matchLunches({
    date: DATE,
    officeId: 'HQ',
    slot: '12:00',
    employees,
    optIns,
    ...extra,
  });
}

describe('matchLunches', () => {
  it('seats every opted-in person', () => {
    const people = distinctPeople(23);
    const result = run(people);
    const seated = result.groups.flatMap((g) => g.members.map((m) => m.id));
    expect(new Set(seated).size).toBe(23);
    expect(result.unmatched).toEqual([]);
  });

  it('never seats the same person twice', () => {
    const people = distinctPeople(41);
    const seated = run(people).groups.flatMap((g) => g.members.map((m) => m.id));
    expect(seated.length).toBe(new Set(seated).size);
  });

  it('reports the whole pool as unmatched when it is too small for one table', () => {
    const result = run(distinctPeople(2));
    expect(result.groups).toEqual([]);
    expect(result.unmatched.map((u) => u.reason)).toEqual(['pool-too-small', 'pool-too-small']);
  });

  it('ignores opt-ins for another date, office or slot', () => {
    const people = distinctPeople(8);
    const optIns = [
      ...people.slice(0, 4).map((e) => optIn(e.id)),
      ...people.slice(4).map((e) => optIn(e.id, { date: '2026-09-17' })),
    ];
    const result = run(people, optIns);
    expect(result.groups.flatMap((g) => g.members).length).toBe(4);
  });

  it('keeps teammates apart when the pool allows it', () => {
    const people = distinctPeople(24);
    for (const group of run(people).groups) {
      const teams = group.members.map((m) => m.team);
      expect(new Set(teams).size).toBe(teams.length);
    }
  });

  it('seats teammates rather than leaving anyone out when it must', () => {
    // Everyone on one team: the only legal outcome needs the last relaxation rung.
    const people = Array.from({ length: 8 }, (_, i) =>
      employee(`e${i + 1}`, { team: 'Engineering/Platform' }),
    );
    const result = run(people);
    expect(result.unmatched).toEqual([]);
    expect(result.groups.every((g) => g.relaxation === 'allow-same-team')).toBe(true);
  });

  it('guarantees every table shares a language', () => {
    const people = [
      ...Array.from({ length: 6 }, (_, i) =>
        employee(`tr${i}`, { languages: ['tr'], team: `T${i}` }),
      ),
      ...Array.from({ length: 6 }, (_, i) =>
        employee(`nl${i}`, { languages: ['nl'], team: `N${i}` }),
      ),
    ];
    for (const group of run(people).groups) {
      expect(group.commonLanguages.length).toBeGreaterThan(0);
    }
  });

  it('does not seat someone who shares no language with anyone', () => {
    const people = [...distinctPeople(8), employee('lonely', { languages: ['is'], team: 'Solo' })];
    const result = run(people);
    expect(result.unmatched.map((u) => u.employee.id)).toEqual(['lonely']);
    expect(result.unmatched[0]?.reason).toBe('no-common-language');
    // Everyone else still gets seated.
    expect(result.groups.flatMap((g) => g.members).length).toBe(8);
  });

  it('avoids re-matching people who met inside the cooldown window', () => {
    const people = distinctPeople(16);
    const pastMatches = [{ date: '2026-09-09', memberIds: ['e1', 'e2', 'e3', 'e4'] }];
    const result = run(people, undefined, { pastMatches });

    for (const group of result.groups) {
      const ids = group.members.map((m) => m.id);
      const recent = ['e1', 'e2', 'e3', 'e4'].filter((id) => ids.includes(id));
      expect(recent.length).toBeLessThanOrEqual(1);
    }
  });

  it('lets people meet again once the cooldown has passed', () => {
    const people = distinctPeople(8);
    const old = [{ date: '2025-01-01', memberIds: ['e1', 'e2', 'e3', 'e4'] }];
    const result = run(people, undefined, { pastMatches: old });
    expect(result.groups.every((g) => g.relaxation === 'none')).toBe(true);
  });

  it('is deterministic for a given seed', () => {
    const people = distinctPeople(37);
    const a = run(people);
    const b = run(people);
    expect(signature(a)).toEqual(signature(b));
  });

  it('produces a different plan for a different seed', () => {
    const people = distinctPeople(37);
    const a = run(people, undefined, { config: { ...DEFAULT_CONFIG, seed: 1 } });
    const b = run(people, undefined, { config: { ...DEFAULT_CONFIG, seed: 999 } });
    expect(signature(a)).not.toEqual(signature(b));
  });

  it('beats seating people next to whoever they already sit next to', () => {
    // Departments cluster in real offices: the baseline is four colleagues from
    // the same floor going to lunch together, which is exactly what we replace.
    const people = distinctPeople(60).map((person, i) =>
      employee(person.id, { ...person, department: `Dept${Math.floor(i / 12)}` }),
    );
    const matched = run(people);
    const matchedCrossDept = crossDepartmentRate(matched.groups.map((g) => g.members));
    const baselineCrossDept = crossDepartmentRate(chunk(people, 4));

    expect(baselineCrossDept).toBeLessThan(0.5);
    expect(matchedCrossDept).toBeGreaterThan(0.9);
  });

  it('carries no special-category data on the group it produces', () => {
    const group = run(distinctPeople(8)).groups[0]!;
    expect(Object.keys(group)).not.toContain('dietary');
    expect(Object.keys(group.members[0]!)).not.toContain('gender');
  });
});

function signature(result: ReturnType<typeof matchLunches>): string {
  return result.groups
    .map((g) =>
      g.members
        .map((m) => m.id)
        .sort()
        .join(','),
    )
    .sort()
    .join('|');
}

function crossDepartmentRate(groups: { department: string }[][]): number {
  let cross = 0;
  let total = 0;
  for (const group of groups) {
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        total++;
        if (group[i]!.department !== group[j]!.department) cross++;
      }
    }
  }
  return total === 0 ? 0 : cross / total;
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i + size <= items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

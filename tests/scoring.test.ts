import { describe, expect, it } from 'vitest';
import { scoreGroup, type ScoringContext } from '../src/core/scoring';
import { MatchHistory } from '../src/core/history';
import { DEFAULT_CONFIG } from '../src/core/types';
import { employee } from './helpers';

function context(pastMatches = []): ScoringContext {
  return {
    history: new MatchHistory(pastMatches, '2026-09-16'),
    config: DEFAULT_CONFIG,
  };
}

describe('scoreGroup', () => {
  it('rewards a spread of departments', () => {
    const mixed = ['a', 'b', 'c', 'd'].map((id, i) =>
      employee(id, { department: `Dept${i}`, team: `Team${i}` }),
    );
    const uniform = ['a', 'b', 'c', 'd'].map((id, i) =>
      employee(id, { department: 'Engineering', team: `Team${i}` }),
    );
    expect(scoreGroup(mixed, context()).department).toBe(1);
    expect(scoreGroup(uniform, context()).department).toBe(0);
  });

  it('rewards a spread of seniority', () => {
    const mixed = [
      employee('a', { seniority: 'intern' }),
      employee('b', { seniority: 'director' }),
      employee('c', { seniority: 'mid' }),
      employee('d', { seniority: 'manager' }),
    ];
    const uniform = ['a', 'b', 'c', 'd'].map((id) => employee(id, { seniority: 'mid' }));
    expect(scoreGroup(mixed, context()).seniority).toBeGreaterThan(
      scoreGroup(uniform, context()).seniority,
    );
  });

  it('scores strangers above people who just met', () => {
    const group = ['a', 'b', 'c', 'd'].map((id) => employee(id));
    const strangers = scoreGroup(group, context()).novelty;
    const acquainted = scoreGroup(
      group,
      context([{ date: '2026-09-15', memberIds: ['a', 'b', 'c', 'd'] }] as never),
    ).novelty;
    expect(strangers).toBe(1);
    expect(acquainted).toBeLessThan(0.1);
  });

  it('has no gender term at all', () => {
    // Sofra stores no gender, so there is nothing here to weight, consent to, or
    // explain to a works council. See docs/privacy.md.
    const breakdown = scoreGroup(['a', 'b', 'c', 'd'].map((id) => employee(id)), context());
    expect(Object.keys(breakdown).sort()).toEqual([
      'department',
      'interests',
      'novelty',
      'seniority',
      'tenure',
      'total',
    ]);
  });
});

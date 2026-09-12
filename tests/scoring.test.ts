import { describe, expect, it } from 'vitest';
import { scoreGroup, type ScoringContext } from '../src/core/scoring.js';
import { MatchHistory } from '../src/core/history.js';
import { DEFAULT_CONFIG } from '../src/core/types.js';
import { employee } from './helpers.js';

function context(consent: string[] = [], pastMatches = []): ScoringContext {
  return {
    history: new MatchHistory(pastMatches, '2026-09-16'),
    config: DEFAULT_CONFIG,
    balanceConsent: new Set(consent),
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
      context([], [{ date: '2026-09-15', memberIds: ['a', 'b', 'c', 'd'] }] as never),
    ).novelty;
    expect(strangers).toBe(1);
    expect(acquainted).toBeLessThan(0.1);
  });

  describe('gender balance', () => {
    const balanced = [
      employee('a', { gender: 'female' }),
      employee('b', { gender: 'female' }),
      employee('c', { gender: 'male' }),
      employee('d', { gender: 'male' }),
    ];
    const skewed = ['a', 'b', 'c', 'd'].map((id) => employee(id, { gender: 'male' }));

    it('is inert for anyone who did not opt in', () => {
      // The privacy promise, enforced: with no consent, a declared gender has no
      // effect whatsoever on the score.
      expect(scoreGroup(balanced, context()).genderBalance).toBe(0);
      expect(scoreGroup(skewed, context()).genderBalance).toBe(0);
      expect(scoreGroup(balanced, context()).total).toBe(scoreGroup(skewed, context()).total);
    });

    it('rewards balance only among people who opted in', () => {
      const consent = ['a', 'b', 'c', 'd'];
      expect(scoreGroup(balanced, context(consent)).genderBalance).toBe(1);
      expect(scoreGroup(skewed, context(consent)).genderBalance).toBe(0);
    });

    it('stays inert when fewer than two people opted in', () => {
      expect(scoreGroup(balanced, context(['a'])).genderBalance).toBe(0);
    });

    it('ignores undisclosed gender without penalising the person', () => {
      const withUndisclosed = [
        employee('a', { gender: 'female' }),
        employee('b', { gender: 'male' }),
        employee('c', { gender: 'undisclosed' }),
        employee('d', { gender: undefined }),
      ];
      expect(scoreGroup(withUndisclosed, context(['a', 'b', 'c', 'd'])).genderBalance).toBe(1);
    });
  });
});

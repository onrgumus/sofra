import type { Employee, MatchConfig, Relaxation } from './types';
import type { MatchHistory } from './history';

/**
 * The relaxation ladder. We try to honour every rule; if the pool is too
 * homogeneous to allow that, we drop rules in this order rather than leaving
 * anyone unseated.
 */
export const RELAXATION_LADDER: readonly Relaxation[] = ['none', 'allow-repeat', 'allow-same-team'];

/**
 * A shared language is never relaxed. Seating four people who cannot talk to
 * each other is worse than not seating them, and it is the one rule that
 * silently ruins the lunch rather than merely making it less interesting.
 */
export function sharedLanguages(members: readonly Employee[]): string[] {
  const [first, ...rest] = members;
  if (!first) return [];
  return first.languages.filter((lang) => rest.every((m) => m.languages.includes(lang)));
}

/** Can `candidate` join `group` at this relaxation level? */
export function canJoin(
  group: readonly Employee[],
  candidate: Employee,
  history: MatchHistory,
  config: MatchConfig,
  relaxation: Relaxation,
): boolean {
  if (group.some((m) => m.id === candidate.id)) return false;
  if (sharedLanguages([...group, candidate]).length === 0) return false;

  if (relaxation !== 'allow-same-team') {
    if (group.some((m) => m.team === candidate.team)) return false;
  }

  if (relaxation === 'none') {
    if (group.some((m) => history.metWithin(m.id, candidate.id, config.repeatCooldownDays))) {
      return false;
    }
  }

  return true;
}

/** Is an already-formed group valid at this relaxation level? */
export function isValidGroup(
  group: readonly Employee[],
  history: MatchHistory,
  config: MatchConfig,
  relaxation: Relaxation,
): boolean {
  if (group.length < config.minGroupSize || group.length > config.maxGroupSize) return false;
  return group.every((member, i) =>
    canJoin(group.slice(0, i), member, history, config, relaxation),
  );
}

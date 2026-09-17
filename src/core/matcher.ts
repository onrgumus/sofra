import { DEFAULT_CONFIG } from './types';
import type {
  Employee,
  MatchConfig,
  MatchResult,
  MatchedGroup,
  OptIn,
  PastMatch,
  Relaxation,
  Unmatched,
} from './types';
import { MatchHistory } from './history';
import { RELAXATION_LADDER, canJoin, isValidGroup, sharedLanguages } from './constraints';
import { scoreGroup, type ScoringContext } from './scoring';
import { planGroupSizes } from './planner';
import { createRng, shuffle } from './rng';

/**
 * Cost of bending a rule, subtracted from a group's score. Large enough that the
 * search prefers a duller but fully legal table over a relaxed one, small enough
 * that it still bends rather than breaks when the pool leaves no choice.
 */
const RELAXATION_PENALTY: Record<Relaxation, number> = {
  none: 0,
  'allow-repeat': 0.75,
  'allow-same-team': 1.5,
};

export interface MatchRequest {
  date: string;
  officeId: string;
  slot: string;
  employees: readonly Employee[];
  optIns: readonly OptIn[];
  pastMatches?: readonly PastMatch[];
  config?: Partial<MatchConfig>;
}

interface WorkingGroup {
  members: Employee[];
  relaxation: Relaxation;
}

export function matchLunches(request: MatchRequest): MatchResult {
  const config: MatchConfig = {
    ...DEFAULT_CONFIG,
    ...request.config,
    weights: { ...DEFAULT_CONFIG.weights, ...request.config?.weights },
  };

  const { date, officeId, slot } = request;
  const byId = new Map(request.employees.map((e) => [e.id, e]));

  const relevant = request.optIns.filter(
    (o) => o.date === date && o.officeId === officeId && o.slot === slot,
  );
  const pool = relevant
    .map((o) => byId.get(o.employeeId))
    .filter((e): e is Employee => e !== undefined && e.officeId === officeId);

  const ctx: ScoringContext = {
    history: new MatchHistory(request.pastMatches ?? [], date),
    config,
  };

  const unmatched: Unmatched[] = [];

  // Too few people for a single table is about the day, not about anybody in
  // it. Checking it first matters because the language partition calls a pool
  // of one "isolated": telling the only person who asked that nobody shares a
  // language with them, and pointing them at their language settings, is both
  // wrong and the kind of wrong that makes somebody stop using a product.
  if (pool.length < config.minGroupSize) {
    for (const employee of pool) unmatched.push({ employee, reason: 'pool-too-small' });
    return { date, officeId, slot, groups: [], unmatched, totalScore: 0 };
  }

  // People who share no language with anyone else today cannot be seated, and we
  // know it before planning. Removing them first keeps the size plan honest;
  // otherwise they anchor a table nobody can join and strand its other seats.
  const { connected, isolated } = partitionByLanguage(pool);
  for (const employee of isolated) unmatched.push({ employee, reason: 'no-common-language' });

  const sizes = planGroupSizes(connected.length, config);

  if (sizes.length === 0) {
    for (const employee of connected) unmatched.push({ employee, reason: 'pool-too-small' });
    return { date, officeId, slot, groups: [], unmatched, totalScore: 0 };
  }

  const rng = createRng(config.seed);
  const groups = seedGroups(shuffle(connected, rng), sizes, ctx, unmatched);
  repairUndersizedGroups(groups, ctx, unmatched);
  improve(groups, ctx, rng);

  const finalised = groups
    .filter((g) => g.members.length > 0)
    .map((g, index) => toMatchedGroup(g, index, request, ctx));

  return {
    date,
    officeId,
    slot,
    groups: finalised,
    unmatched,
    totalScore: finalised.reduce((sum, g) => sum + g.score, 0),
  };
}

/**
 * Splits the pool into people who share a language with at least one other person
 * and people who share none with anyone.
 */
function partitionByLanguage(pool: readonly Employee[]): {
  connected: Employee[];
  isolated: Employee[];
} {
  const connected: Employee[] = [];
  const isolated: Employee[] = [];

  for (const person of pool) {
    const hasPartner = pool.some(
      (other) =>
        other.id !== person.id && other.languages.some((l) => person.languages.includes(l)),
    );
    (hasPartner ? connected : isolated).push(person);
  }
  return { connected, isolated };
}

/**
 * Language splits can leave a table below the minimum. Dissolve those tables and
 * re-seat their members elsewhere; the size plan guarantees the spare capacity
 * exists, so only a language barrier can still turn someone away.
 */
function repairUndersizedGroups(
  groups: WorkingGroup[],
  ctx: ScoringContext,
  unmatched: Unmatched[],
): void {
  const undersized = groups.filter((g) => g.members.length < ctx.config.minGroupSize);
  if (undersized.length === 0) return;

  const orphans: Employee[] = [];
  for (const group of undersized) {
    orphans.push(...group.members);
    group.members = [];
    group.relaxation = 'none';
  }

  const survivors = groups.filter((g) => g.members.length > 0);
  for (const orphan of orphans) {
    if (!placeLeftover(orphan, survivors, ctx)) {
      unmatched.push({ employee: orphan, reason: 'no-common-language' });
    }
  }
}

/**
 * Greedy construction. Each group starts from the hardest person left to place,
 * seating the constrained people first is what stops them being stranded at the
 * end, then grows by whichever candidate adds the most score.
 */
function seedGroups(
  pool: readonly Employee[],
  sizes: readonly number[],
  ctx: ScoringContext,
  unmatched: Unmatched[],
): WorkingGroup[] {
  const remaining = pool.slice();
  const groups: WorkingGroup[] = [];

  for (const size of sizes) {
    if (remaining.length === 0) break;

    const seed = takeMostConstrained(remaining, ctx);
    const group: WorkingGroup = { members: [seed], relaxation: 'none' };

    while (group.members.length < size && remaining.length > 0) {
      const pick = bestCandidate(group, remaining, ctx);
      if (!pick) break;
      group.relaxation = maxRelaxation(group.relaxation, pick.relaxation);
      group.members.push(pick.employee);
      remaining.splice(remaining.indexOf(pick.employee), 1);
    }
    groups.push(group);
  }

  // Anyone left over joins the group that wants them most, rather than forming a
  // runt group or being dropped.
  for (const leftover of remaining.slice()) {
    const placed = placeLeftover(leftover, groups, ctx);
    remaining.splice(remaining.indexOf(leftover), 1);
    if (!placed) unmatched.push({ employee: leftover, reason: 'no-common-language' });
  }

  return groups;
}

/** The person with the fewest compatible partners left, removed from `remaining`. */
function takeMostConstrained(remaining: Employee[], ctx: ScoringContext): Employee {
  let bestIndex = 0;
  let bestOptions = Number.POSITIVE_INFINITY;

  for (let i = 0; i < remaining.length; i++) {
    const person = remaining[i]!;
    let options = 0;
    for (const other of remaining) {
      if (other.id === person.id) continue;
      if (canJoin([person], other, ctx.history, ctx.config, 'none')) options++;
    }
    if (options < bestOptions) {
      bestOptions = options;
      bestIndex = i;
    }
  }
  return remaining.splice(bestIndex, 1)[0]!;
}

interface Candidate {
  employee: Employee;
  relaxation: Relaxation;
}

/** Highest-scoring addition, searching the relaxation ladder only as far as needed. */
function bestCandidate(
  group: WorkingGroup,
  remaining: readonly Employee[],
  ctx: ScoringContext,
): Candidate | null {
  for (const relaxation of RELAXATION_LADDER) {
    let best: Candidate | null = null;
    let bestScore = Number.NEGATIVE_INFINITY;

    for (const employee of remaining) {
      if (!canJoin(group.members, employee, ctx.history, ctx.config, relaxation)) continue;
      const score = scoreGroup([...group.members, employee], ctx).total;
      if (score > bestScore) {
        bestScore = score;
        best = { employee, relaxation };
      }
    }
    if (best) return best;
  }
  return null;
}

function placeLeftover(
  person: Employee,
  groups: readonly WorkingGroup[],
  ctx: ScoringContext,
): boolean {
  for (const relaxation of RELAXATION_LADDER) {
    let bestGroup: WorkingGroup | null = null;
    let bestScore = Number.NEGATIVE_INFINITY;

    for (const group of groups) {
      if (group.members.length >= ctx.config.maxGroupSize) continue;
      if (!canJoin(group.members, person, ctx.history, ctx.config, relaxation)) continue;
      const score = scoreGroup([...group.members, person], ctx).total;
      if (score > bestScore) {
        bestScore = score;
        bestGroup = group;
      }
    }
    if (bestGroup) {
      bestGroup.members.push(person);
      bestGroup.relaxation = maxRelaxation(bestGroup.relaxation, relaxation);
      return true;
    }
  }
  return false;
}

/**
 * 2-opt local search: repeatedly try swapping one member between two groups and
 * keep the swap when the penalised total improves. Cheap, and it recovers most of
 * the gap between the greedy plan and an optimal one.
 */
function improve(groups: WorkingGroup[], ctx: ScoringContext, rng: () => number): void {
  if (groups.length < 2) return;

  for (let iteration = 0; iteration < ctx.config.localSearchIterations; iteration++) {
    const a = groups[Math.floor(rng() * groups.length)]!;
    const b = groups[Math.floor(rng() * groups.length)]!;
    if (a === b || a.members.length === 0 || b.members.length === 0) continue;

    const i = Math.floor(rng() * a.members.length);
    const j = Math.floor(rng() * b.members.length);
    const before = penalisedScore(a, ctx) + penalisedScore(b, ctx);

    [a.members[i], b.members[j]] = [b.members[j]!, a.members[i]!];

    const relaxA = minimalRelaxation(a.members, ctx);
    const relaxB = minimalRelaxation(b.members, ctx);

    if (relaxA === null || relaxB === null) {
      [a.members[i], b.members[j]] = [b.members[j]!, a.members[i]!];
      continue;
    }

    const after =
      scoreGroup(a.members, ctx).total -
      RELAXATION_PENALTY[relaxA] +
      scoreGroup(b.members, ctx).total -
      RELAXATION_PENALTY[relaxB];

    if (after > before) {
      a.relaxation = relaxA;
      b.relaxation = relaxB;
    } else {
      [a.members[i], b.members[j]] = [b.members[j]!, a.members[i]!];
    }
  }
}

function penalisedScore(group: WorkingGroup, ctx: ScoringContext): number {
  return scoreGroup(group.members, ctx).total - RELAXATION_PENALTY[group.relaxation];
}

/** Lowest ladder rung at which this group is legal, or null if none is. */
function minimalRelaxation(members: readonly Employee[], ctx: ScoringContext): Relaxation | null {
  for (const relaxation of RELAXATION_LADDER) {
    if (isValidGroup(members, ctx.history, ctx.config, relaxation)) return relaxation;
  }
  return null;
}

function maxRelaxation(a: Relaxation, b: Relaxation): Relaxation {
  return RELAXATION_LADDER.indexOf(a) >= RELAXATION_LADDER.indexOf(b) ? a : b;
}

function toMatchedGroup(
  group: WorkingGroup,
  index: number,
  request: MatchRequest,
  ctx: ScoringContext,
): MatchedGroup {
  return {
    id: `${request.date}-${request.officeId}-${request.slot}-${index + 1}`,
    date: request.date,
    officeId: request.officeId,
    slot: request.slot,
    members: group.members,
    score: scoreGroup(group.members, ctx).total,
    relaxation: group.relaxation,
    commonLanguages: sharedLanguages(group.members),
  };
}

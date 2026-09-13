import { SENIORITY_LADDER } from './types';
import type { Employee, MatchConfig, Seniority } from './types';
import type { MatchHistory } from './history';

/** Tenure gap (months) at which the spread signal saturates. */
const TENURE_SATURATION = 60;

const SENIORITY_INDEX = new Map<Seniority, number>(SENIORITY_LADDER.map((s, i) => [s, i]));
const MAX_SENIORITY_DISTANCE = SENIORITY_LADDER.length - 1;

export interface ScoringContext {
  history: MatchHistory;
  config: MatchConfig;
}

export interface ScoreBreakdown {
  department: number;
  seniority: number;
  tenure: number;
  interests: number;
  novelty: number;
  total: number;
}

/** Every unordered pair in the group. */
function pairs<T>(items: readonly T[]): [T, T][] {
  const out: [T, T][] = [];
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) out.push([items[i]!, items[j]!]);
  }
  return out;
}

/** 0 when everyone shares a department, 1 when all differ. */
function departmentScore(members: readonly Employee[]): number {
  if (members.length < 2) return 0;
  const distinct = new Set(members.map((m) => m.department)).size;
  return (distinct - 1) / (members.length - 1);
}

/** Mean pairwise distance on the seniority ladder, so intern next to director scores high. */
function seniorityScore(members: readonly Employee[]): number {
  const ps = pairs(members);
  if (ps.length === 0) return 0;
  const total = ps.reduce((sum, [a, b]) => {
    const ia = SENIORITY_INDEX.get(a.seniority) ?? 0;
    const ib = SENIORITY_INDEX.get(b.seniority) ?? 0;
    return sum + Math.abs(ia - ib) / MAX_SENIORITY_DISTANCE;
  }, 0);
  return total / ps.length;
}

function tenureScore(members: readonly Employee[]): number {
  const ps = pairs(members);
  if (ps.length === 0) return 0;
  const total = ps.reduce(
    (sum, [a, b]) =>
      sum + Math.min(1, Math.abs(a.tenureMonths - b.tenureMonths) / TENURE_SATURATION),
    0,
  );
  return total / ps.length;
}

/**
 * Fraction of pairs sharing at least one interest, plus a bonus when something
 * is common to the whole table. Interests are the icebreaker, so this pulls in
 * the opposite direction to the diversity terms on purpose.
 */
function interestScore(members: readonly Employee[]): number {
  const ps = pairs(members);
  if (ps.length === 0) return 0;
  const connected = ps.filter(([a, b]) => a.interests.some((i) => b.interests.includes(i))).length;
  const [first, ...rest] = members;
  const groupWide = first
    ? first.interests.some((i) => rest.every((m) => m.interests.includes(i)))
    : false;
  return Math.min(1, connected / ps.length + (groupWide ? 0.25 : 0));
}

/** Strangers score 1; the signal recovers linearly over twice the cooldown. */
function noveltyScore(members: readonly Employee[], ctx: ScoringContext): number {
  const ps = pairs(members);
  if (ps.length === 0) return 0;
  const horizon = Math.max(1, ctx.config.repeatCooldownDays * 2);
  const total = ps.reduce((sum, [a, b]) => {
    const since = ctx.history.daysSince(a.id, b.id);
    return sum + (since === null ? 1 : Math.min(1, since / horizon));
  }, 0);
  return total / ps.length;
}

export function scoreGroup(members: readonly Employee[], ctx: ScoringContext): ScoreBreakdown {
  const w = ctx.config.weights;
  const parts = {
    department: departmentScore(members),
    seniority: seniorityScore(members),
    tenure: tenureScore(members),
    interests: interestScore(members),
    novelty: noveltyScore(members, ctx),
  };
  const total =
    parts.department * w.department +
    parts.seniority * w.seniority +
    parts.tenure * w.tenure +
    parts.interests * w.interests +
    parts.novelty * w.novelty;
  return { ...parts, total };
}

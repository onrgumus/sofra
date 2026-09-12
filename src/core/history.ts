import type { PastMatch } from './types.js';

const MS_PER_DAY = 86_400_000;

/** Undirected pair key, stable regardless of argument order. */
export function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/**
 * Days since each pair of people last had lunch together. Absent pair = never.
 */
export class MatchHistory {
  private readonly lastMetDays = new Map<string, number>();

  constructor(past: readonly PastMatch[], today: string) {
    const now = Date.parse(`${today}T00:00:00Z`);
    for (const match of past) {
      const daysAgo = Math.round((now - Date.parse(`${match.date}T00:00:00Z`)) / MS_PER_DAY);
      if (daysAgo < 0) continue; // future records are noise, ignore them
      for (let i = 0; i < match.memberIds.length; i++) {
        for (let j = i + 1; j < match.memberIds.length; j++) {
          const key = pairKey(match.memberIds[i]!, match.memberIds[j]!);
          const known = this.lastMetDays.get(key);
          if (known === undefined || daysAgo < known) this.lastMetDays.set(key, daysAgo);
        }
      }
    }
  }

  /** Days since these two last met, or `null` if they never have. */
  daysSince(a: string, b: string): number | null {
    return this.lastMetDays.get(pairKey(a, b)) ?? null;
  }

  metWithin(a: string, b: string, days: number): boolean {
    const since = this.daysSince(a, b);
    return since !== null && since < days;
  }
}

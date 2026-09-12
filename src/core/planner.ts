import type { MatchConfig } from './types';

/**
 * Decide how many groups to form and how big each one is.
 *
 * Everyone in the pool gets a seat: we pick the group count whose sizes stay
 * within [min, max] and land closest to the preferred size, then spread the
 * remainder one person at a time. 9 people become [5,4] rather than [4,4] plus
 * someone left standing in the lobby.
 */
export function planGroupSizes(poolSize: number, config: MatchConfig): number[] {
  const { groupSize, minGroupSize, maxGroupSize } = config;
  if (poolSize < minGroupSize) return [];

  const ideal = poolSize / groupSize;
  let best: { k: number; distance: number } | null = null;

  for (let k = 1; k <= Math.floor(poolSize / minGroupSize); k++) {
    const feasible = poolSize >= k * minGroupSize && poolSize <= k * maxGroupSize;
    if (!feasible) continue;
    const distance = Math.abs(k - ideal);
    if (!best || distance < best.distance) best = { k, distance };
  }

  // No group count satisfies the size bounds (e.g. max is small and the pool is
  // awkward). Fall back to as many preferred-size groups as fit and let the last
  // one absorb the remainder.
  if (!best) {
    const k = Math.max(1, Math.floor(poolSize / groupSize));
    return distribute(poolSize, k);
  }

  return distribute(poolSize, best.k);
}

/** Split `total` into `k` sizes differing by at most one, largest first. */
function distribute(total: number, k: number): number[] {
  const base = Math.floor(total / k);
  const remainder = total % k;
  return Array.from({ length: k }, (_, i) => base + (i < remainder ? 1 : 0));
}

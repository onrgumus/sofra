import { describe, expect, it } from 'vitest';
import { planGroupSizes } from '../src/core/planner';
import { DEFAULT_CONFIG } from '../src/core/types';

describe('planGroupSizes', () => {
  it('forms no group when the pool is below the minimum', () => {
    expect(planGroupSizes(2, DEFAULT_CONFIG)).toEqual([]);
  });

  it('seats everyone, never dropping the remainder', () => {
    for (let poolSize = 3; poolSize <= 200; poolSize++) {
      const sizes = planGroupSizes(poolSize, DEFAULT_CONFIG);
      expect(sizes.reduce((a, b) => a + b, 0)).toBe(poolSize);
    }
  });

  it('keeps every group within the configured size bounds', () => {
    for (let poolSize = 3; poolSize <= 200; poolSize++) {
      if (poolSize === 5) continue; // the one size that cannot be split into 3s and 4s
      for (const size of planGroupSizes(poolSize, DEFAULT_CONFIG)) {
        expect(size).toBeGreaterThanOrEqual(DEFAULT_CONFIG.minGroupSize);
        expect(size).toBeLessThanOrEqual(DEFAULT_CONFIG.maxGroupSize);
      }
    }
  });

  it('splits into threes and fours rather than stranding anyone', () => {
    expect(planGroupSizes(9, DEFAULT_CONFIG).sort()).toEqual([3, 3, 3]);
    expect(planGroupSizes(7, DEFAULT_CONFIG).sort()).toEqual([3, 4]);
    expect(planGroupSizes(11, DEFAULT_CONFIG).sort()).toEqual([3, 4, 4]);
  });

  it('seats five at one table, the only pool size threes and fours cannot cover', () => {
    // 5 splits into neither 3+3 nor 4+4 without inventing or dropping a person,
    // so one slightly crowded table beats turning someone away.
    expect(planGroupSizes(5, DEFAULT_CONFIG)).toEqual([5]);
  });

  it('uses the preferred size when it divides evenly', () => {
    expect(planGroupSizes(16, DEFAULT_CONFIG)).toEqual([4, 4, 4, 4]);
  });

  it('never plans a table larger than four for any realistic pool', () => {
    for (let poolSize = 6; poolSize <= 500; poolSize++) {
      expect(Math.max(...planGroupSizes(poolSize, DEFAULT_CONFIG))).toBeLessThanOrEqual(4);
    }
  });
});

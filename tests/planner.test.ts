import { describe, expect, it } from 'vitest';
import { planGroupSizes } from '../src/core/planner.js';
import { DEFAULT_CONFIG } from '../src/core/types.js';

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
      for (const size of planGroupSizes(poolSize, DEFAULT_CONFIG)) {
        expect(size).toBeGreaterThanOrEqual(DEFAULT_CONFIG.minGroupSize);
        expect(size).toBeLessThanOrEqual(DEFAULT_CONFIG.maxGroupSize);
      }
    }
  });

  it('prefers one oversized table over stranding a single person', () => {
    // 9 people: [5,4] beats [4,4] plus somebody left over.
    expect(planGroupSizes(9, DEFAULT_CONFIG).sort()).toEqual([4, 5]);
  });

  it('uses the preferred size when it divides evenly', () => {
    expect(planGroupSizes(16, DEFAULT_CONFIG)).toEqual([4, 4, 4, 4]);
  });
});

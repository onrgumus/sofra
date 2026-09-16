import { afterEach, describe, expect, it, vi } from 'vitest';
import { envNumber, envOptional, envText } from '../src/lib/env';

describe('reading configuration', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('falls back when a variable is set to nothing', () => {
    // The bug this exists for: a hosting dashboard happily saves a variable
    // with an empty value, `??` does not treat that as absent, and the sign-in
    // page went live advertising "onur / " with no password that could work.
    vi.stubEnv('SOFRA_TEST_VALUE', '');
    expect(envText('SOFRA_TEST_VALUE', 'fallback')).toBe('fallback');
  });

  it('treats whitespace as nothing too', () => {
    vi.stubEnv('SOFRA_TEST_VALUE', '   ');
    expect(envText('SOFRA_TEST_VALUE', 'fallback')).toBe('fallback');
  });

  it('falls back when a variable is absent', () => {
    vi.stubEnv('SOFRA_TEST_VALUE', '');
    expect(envText('SOFRA_TEST_MISSING', 'fallback')).toBe('fallback');
  });

  it('uses a real value, and does not trim it', () => {
    vi.stubEnv('SOFRA_TEST_VALUE', ' Sofra <a@b.c> ');
    expect(envText('SOFRA_TEST_VALUE', 'fallback')).toBe(' Sofra <a@b.c> ');
  });

  it('keeps a value that only looks empty', () => {
    vi.stubEnv('SOFRA_TEST_VALUE', '0');
    expect(envText('SOFRA_TEST_VALUE', 'fallback')).toBe('0');
  });

  describe('numbers', () => {
    it('reads one', () => {
      vi.stubEnv('SOFRA_TEST_NUMBER', '8');
      expect(envNumber('SOFRA_TEST_NUMBER', 3)).toBe(8);
    });

    it('falls back on blank rather than becoming zero', () => {
      // Number('') is 0, which would silently make a connection pool of none.
      vi.stubEnv('SOFRA_TEST_NUMBER', '');
      expect(envNumber('SOFRA_TEST_NUMBER', 3)).toBe(3);
    });

    it('falls back on nonsense rather than becoming NaN', () => {
      vi.stubEnv('SOFRA_TEST_NUMBER', 'lots');
      expect(envNumber('SOFRA_TEST_NUMBER', 3)).toBe(3);
    });

    it('keeps a legitimate zero', () => {
      vi.stubEnv('SOFRA_TEST_NUMBER', '0');
      expect(envNumber('SOFRA_TEST_NUMBER', 3)).toBe(0);
    });
  });

  describe('optional values', () => {
    it('is undefined when blank, so a guard can tell it was never set', () => {
      vi.stubEnv('SOFRA_TEST_VALUE', '');
      expect(envOptional('SOFRA_TEST_VALUE')).toBeUndefined();
      vi.stubEnv('SOFRA_TEST_VALUE', '  ');
      expect(envOptional('SOFRA_TEST_VALUE')).toBeUndefined();
    });

    it('returns a real value', () => {
      vi.stubEnv('SOFRA_TEST_VALUE', 'secret');
      expect(envOptional('SOFRA_TEST_VALUE')).toBe('secret');
    });
  });
});

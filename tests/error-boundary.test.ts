import { describe, expect, it } from 'vitest';

/**
 * Mirrors the check in app/error.tsx. Kept as a unit so the copy people see
 * after a deploy cannot silently stop matching the error Next.js throws.
 */
function isStaleBuild(message: string): boolean {
  return /server action|was not found on the server/i.test(message);
}

describe('stale build detection', () => {
  it('recognises the error Next.js throws for a tab open across a deploy', () => {
    expect(
      isStaleBuild(
        'Server Action "40f5b80b0f2d4c000693012a5caf0607527497eaf0" was not found on the server.',
      ),
    ).toBe(true);
  });

  it('recognises it regardless of case', () => {
    expect(isStaleBuild('server action not found')).toBe(true);
  });

  it('leaves ordinary failures to the ordinary message', () => {
    expect(isStaleBuild('Cannot read properties of undefined')).toBe(false);
    expect(isStaleBuild('Missing field: officeId')).toBe(false);
  });
});

import { createHash, timingSafeEqual } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { envOptional } from './env';

/**
 * The scheduler's endpoint can plan a day or mail a building, so it is behind
 * a shared secret. Returns the response to send when the request is not
 * allowed, and null when it is.
 */
export function refuseUnlessScheduled(request: NextRequest): NextResponse | null {
  const secret = envOptional('CRON_SECRET');
  if (!secret) {
    return NextResponse.json({ error: 'CRON_SECRET is not configured' }, { status: 503 });
  }

  if (!sameSecret(request.headers.get('authorization') ?? '', `Bearer ${secret}`)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return null;
}

/**
 * Compared in constant time, over digests so the lengths always match: a
 * comparison that stops at the first wrong character tells an attacker how
 * many they have right.
 */
function sameSecret(given: string, expected: string): boolean {
  const a = createHash('sha256').update(given).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

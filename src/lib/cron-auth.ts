import { NextResponse, type NextRequest } from 'next/server';
import { envOptional } from './env';

/**
 * Both scheduled endpoints can reshuffle a day or mail a building, so both are
 * behind the same secret, checked the same way. Returns the response to send
 * when the request is not allowed, and null when it is.
 */
export function refuseUnlessScheduled(request: NextRequest): NextResponse | null {
  const secret = envOptional('CRON_SECRET');
  if (!secret) {
    return NextResponse.json({ error: 'CRON_SECRET is not configured' }, { status: 503 });
  }

  if (request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  return null;
}

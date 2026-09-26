import { NextResponse } from 'next/server';
import { getDb } from '../../../src/db';

export const dynamic = 'force-dynamic';

/** For the load balancer: the process answers and the database does too. Says nothing else. */
export async function GET(): Promise<NextResponse> {
  try {
    await getDb().query('SELECT 1');
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false }, { status: 503 });
  }
}

import { NextResponse, type NextRequest } from 'next/server';
import { runNightlyMatching } from '../../../src/lib/nightly';
import { ConsoleTransport } from '../../../src/notify/transport';
import { getStore } from '../../../src/store/instance';

export const dynamic = 'force-dynamic';

/**
 * The nightly job. Point a scheduler at it — on Vercel, `vercel.json` already
 * does — and matching stops needing anyone to press a button.
 *
 * Guarded by CRON_SECRET. Without one set, the endpoint refuses rather than
 * running openly: anyone who can reach it can reshuffle tomorrow's tables and
 * send mail to the whole company.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: 'CRON_SECRET is not configured' }, { status: 503 });
  }

  const provided = request.headers.get('authorization');
  if (provided !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const outcomes = await runNightlyMatching({
    store: getStore(),
    // Swap for ResendTransport once a key is configured; the interface is the
    // only thing the job depends on.
    transport: new ConsoleTransport(),
    from: process.env.SOFRA_FROM_EMAIL ?? 'Sofra <sofra@example.com>',
  });

  return NextResponse.json({ ranAt: new Date().toISOString(), offices: outcomes });
}

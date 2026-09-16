import { NextResponse, type NextRequest } from 'next/server';
import { runNightlyMatching } from '../../../src/lib/nightly';
import { configuredChannel, FROM_EMAIL } from '../../../src/lib/channel';
import { getStore } from '../../../src/store/instance';

export const dynamic = 'force-dynamic';

/**
 * The nightly job. Point a scheduler at it. On Vercel, `vercel.json` already
 * does, and matching stops needing anyone to press a button.
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
    // Email always, plus Slack and Teams where this deployment has tokens.
    channel: configuredChannel(),
    from: FROM_EMAIL,
  });

  // A run that could not deliver some tables is not a successful run, even
  // though it did everything else it could. 207 says so without pretending the
  // whole thing failed.
  const undelivered = outcomes.reduce((total, o) => total + o.failedToDeliver, 0);
  return NextResponse.json(
    { ranAt: new Date().toISOString(), offices: outcomes },
    { status: undelivered > 0 ? 207 : 200 },
  );
}

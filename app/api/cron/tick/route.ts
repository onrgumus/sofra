import { NextResponse, type NextRequest } from 'next/server';
import { refuseUnlessScheduled } from '../../../../src/lib/cron-auth';
import { tickDeps } from '../../../../src/services/runtime';
import { runTick } from '../../../../src/services/tick';

export const dynamic = 'force-dynamic';
// A morning with several offices on a hosted database takes more than the default few seconds.
export const maxDuration = 60;

/**
 * What the scheduler calls every fifteen minutes. It works out, office by
 * office in each office's own time, what is due, and does it once: making the
 * day's tables, asking about tomorrow, syncing the directory. Safe to call
 * more often, twice at once, or late.
 */
async function tick(request: NextRequest): Promise<NextResponse> {
  const refusal = refuseUnlessScheduled(request);
  if (refusal) return refusal;

  const actions = await runTick(tickDeps(new Date()));
  const failed = actions.filter((a) => a.status === 'failed').length;
  return NextResponse.json(
    { ranAt: new Date().toISOString(), actions },
    { status: failed > 0 ? 207 : 200 },
  );
}

export const GET = tick;
export const POST = tick;

import { NextResponse, type NextRequest } from 'next/server';
import { configuredChannel } from '../../../../src/lib/channel';
import { refuseUnlessScheduled } from '../../../../src/lib/cron-auth';
import { sendReminders } from '../../../../src/lib/reminders';
import { getStore } from '../../../../src/store/instance';

export const dynamic = 'force-dynamic';

/**
 * The morning job: asks everyone who will be in the building tomorrow whether
 * they want lunch with people they have not met.
 *
 * Separate from the matching cron, and earlier in the day, because the answer
 * has to arrive before matching runs. Safe to call twice: nobody is asked about
 * the same day more than once.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const refusal = refuseUnlessScheduled(request);
  if (refusal) return refusal;

  const outcomes = await sendReminders({ store: getStore(), channel: configuredChannel() });

  const failed = outcomes.reduce((total, o) => total + o.failed.length, 0);
  return NextResponse.json(
    { ranAt: new Date().toISOString(), offices: outcomes },
    { status: failed > 0 ? 207 : 200 },
  );
}

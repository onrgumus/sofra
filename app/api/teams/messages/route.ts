import { NextResponse, type NextRequest } from 'next/server';
import { getDb } from '../../../../src/db';
import { BASE_URL } from '../../../../src/lib/config';
import { configuredChannel, FROM_EMAIL } from '../../../../src/services/mail';
import { verifyBotRequest } from '../../../../src/teams/auth';
import { botConfig, trustedServiceUrl } from '../../../../src/teams/config';
import { createConnector } from '../../../../src/teams/connector';
import { handleActivity, type Activity } from '../../../../src/teams/handler';

export const dynamic = 'force-dynamic';

/**
 * The Teams bot's messaging endpoint. Every request must carry a token the
 * Bot Framework signed for this bot and this conversation's service; anything
 * else is refused before a byte of it is acted on.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const config = botConfig();
  if (!config)
    return NextResponse.json({ error: 'The Teams bot is not configured' }, { status: 503 });

  let activity: Activity;
  try {
    activity = (await request.json()) as Activity;
  } catch {
    return NextResponse.json({ error: 'Expected a JSON activity' }, { status: 400 });
  }
  if (typeof activity?.serviceUrl !== 'string' || !trustedServiceUrl(activity.serviceUrl)) {
    return NextResponse.json({ error: 'Unexpected service URL' }, { status: 400 });
  }

  try {
    await verifyBotRequest(request.headers.get('authorization'), {
      appId: config.appId,
      serviceUrl: activity.serviceUrl,
    });
  } catch (error) {
    console.warn('[sofra] bot request refused:', error);
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const result = await handleActivity(
    {
      db: getDb(),
      connector: createConnector(config),
      channel: configuredChannel(),
      from: FROM_EMAIL,
      now: () => new Date(),
      baseUrl: BASE_URL,
    },
    activity,
  );
  return result.body === undefined
    ? new NextResponse(null, { status: result.status })
    : NextResponse.json(result.body, { status: result.status });
}

import type { Db } from '../db';
import { saveTeamsConversation } from '../data/messages';
import { findPerson, toEmployee } from '../data/people';
import { getOffice } from '../data/offices';
import { getTable } from '../data/tables';
import type { Person, RsvpStatus } from '../data/types';
import { confirmUrl } from '../lib/config';
import { formatDay } from '../lib/dates';
import { openInTeamsUrl } from '../lib/teams-mode';
import type { InviteChannel } from '../notify/channels';
import { respond, wantLunch, phaseOf, type DayOutcome } from '../services/days';
import { venueOf } from '../services/delivery';
import { cardAttachment, inviteCard, noticeCard, type Card } from './cards';
import type { Connector } from './connector';

export interface BotDeps {
  db: Db;
  connector: Connector;
  channel: InviteChannel;
  from: string;
  now: () => Date;
  baseUrl: string;
}

/** The parts of a Bot Framework activity this bot reads. */
export interface Activity {
  type: string;
  name?: string;
  serviceUrl: string;
  from?: { id?: string; aadObjectId?: string; name?: string };
  conversation?: { id: string; conversationType?: string; tenantId?: string };
  channelData?: { tenant?: { id?: string } };
  value?: { action?: { verb?: string; data?: Record<string, unknown> } };
  action?: string;
}

export interface BotResponse {
  status: number;
  body?: unknown;
}

function openUrl(baseUrl: string): string {
  return openInTeamsUrl() ?? `${baseUrl}/`;
}

/**
 * Everything the Teams bot does in answer to Teams.
 *
 * It only ever works in a person's own chat with it, and it only ever acts as
 * the person the Bot Framework says clicked: the Entra object id on a verified
 * activity. A card's data says which table or day, never who.
 */
export async function handleActivity(deps: BotDeps, activity: Activity): Promise<BotResponse> {
  const person = activity.from?.aadObjectId
    ? await findPerson(deps.db, { entraObjectId: activity.from.aadObjectId })
    : null;

  if (person && activity.conversation?.conversationType === 'personal') {
    await saveTeamsConversation(deps.db, {
      employeeId: person.id,
      conversationId: activity.conversation.id,
      serviceUrl: activity.serviceUrl,
      tenantId: activity.channelData?.tenant?.id ?? activity.conversation.tenantId ?? '',
    });
  }

  if (activity.type === 'invoke' && activity.name === 'adaptiveCard/action') {
    return { status: 200, body: invokeCard(await onAction(deps, person, activity)) };
  }

  if (
    activity.type === 'message' ||
    (activity.type === 'installationUpdate' && activity.action === 'add')
  ) {
    const card = person
      ? noticeCard(
          'Sofra',
          'Your lunch invitations will arrive here, and you can answer them without leaving the chat. Pick your days in the Sofra tab.',
          openUrl(deps.baseUrl),
        )
      : noticeCard(
          'Welcome to Sofra',
          'Open the Sofra tab once to say which office you work in. After that your lunch invitations arrive here.',
          openUrl(deps.baseUrl),
        );
    if (activity.conversation) {
      await deps.connector
        .send(activity.serviceUrl, activity.conversation.id, {
          type: 'message',
          attachments: [cardAttachment(card)],
        })
        .catch((error: unknown) => console.warn('[sofra] bot reply failed:', error));
    }
  }

  return { status: 200 };
}

function invokeCard(card: Card) {
  return { statusCode: 200, type: 'application/vnd.microsoft.card.adaptive', value: card };
}

async function onAction(deps: BotDeps, person: Person | null, activity: Activity): Promise<Card> {
  if (!person || !person.onboardedAt) {
    return noticeCard(
      'Set up Sofra first',
      'Open the Sofra tab and say which office you work in, then try again.',
      openUrl(deps.baseUrl),
    );
  }

  const verb = activity.value?.action?.verb;
  const data = activity.value?.action?.data ?? {};
  const dayDeps = { db: deps.db, channel: deps.channel, from: deps.from, now: deps.now() };

  if (verb === 'rsvp') {
    const tableId = String(data['tableId'] ?? '');
    const status = data['status'] === 'declined' ? 'declined' : 'accepted';
    const outcome = await respond(dayDeps, person, tableId, status as RsvpStatus);
    if (!outcome.ok)
      return noticeCard('That did not work', explain(outcome), openUrl(deps.baseUrl));
    return (await tableCard(deps, person, tableId)) ?? noticeCard('Done', 'Your reply is in.');
  }

  if (verb === 'want') {
    const date = String(data['date'] ?? '');
    const officeId = String(data['officeId'] ?? person.officeId ?? '');
    const outcome = await wantLunch(dayDeps, person, {
      date,
      officeId,
      slot: null,
      source: 'teams',
    });
    if (!outcome.ok)
      return noticeCard('That did not work', explain(outcome), openUrl(deps.baseUrl));
    return noticeCard(
      "You're in",
      `You will get your table for ${formatDay(date)} on the morning, here and by mail.`,
      openUrl(deps.baseUrl),
    );
  }

  return noticeCard(
    'Sofra',
    'That button is out of date. Open Sofra to see where things stand.',
    openUrl(deps.baseUrl),
  );
}

async function tableCard(deps: BotDeps, person: Person, tableId: string): Promise<Card | null> {
  const table = await getTable(deps.db, tableId);
  if (!table) return null;
  const office = await getOffice(deps.db, table.officeId);
  if (!office) return null;
  const phase = await phaseOf(deps.db, office, table.date, deps.now());
  const venue = venueOf(office, table.timeZone);
  return inviteCard({
    tableId: table.id,
    dayLabel: formatDay(table.date),
    slot: table.slot,
    place: `${venue.displayName} — ${venue.meetingPoint}`,
    members: table.members.length > 0 ? table.members : [toEmployee(person)],
    forEmployeeId: person.id,
    status: table.rsvps[person.id] ?? 'pending',
    confirmUrl: confirmUrl(table.id),
    canReply: phase === 'matched' || phase === 'closed',
  });
}

function explain(outcome: Extract<DayOutcome, { ok: false }>): string {
  switch (outcome.reason) {
    case 'closed':
      return 'Replies for that day have closed.';
    case 'off':
      return 'The office is closed that day.';
    case 'no-seat':
      return 'The tables were already made and none has a free seat that keeps everyone a stranger.';
    case 'not-seated':
      return 'You are not at that table any more.';
    default:
      return 'Open Sofra to see where things stand.';
  }
}

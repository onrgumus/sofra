import type { Employee } from '../core/types';
import type { RsvpStatus } from '../data/types';

/**
 * Adaptive Cards the bot sends. Buttons are Action.Execute, so a click comes
 * back to the bot as an invoke and the card is replaced with its result in
 * place: the person sees "You're coming" where the button was, without opening
 * anything.
 */
export type Card = Record<string, unknown>;

const SCHEMA = 'http://adaptivecards.io/schemas/adaptive-card.json';

export function cardAttachment(card: Card) {
  return { contentType: 'application/vnd.microsoft.card.adaptive', content: card };
}

export function inviteCard(options: {
  tableId: string;
  dayLabel: string;
  slot: string;
  place: string;
  members: readonly Employee[];
  forEmployeeId: string;
  status: RsvpStatus;
  confirmUrl: string;
  canReply: boolean;
}): Card {
  const others = options.members.filter((m) => m.id !== options.forEmployeeId);
  return {
    $schema: SCHEMA,
    type: 'AdaptiveCard',
    version: '1.5',
    body: [
      {
        type: 'TextBlock',
        text: `Lunch ${options.dayLabel} at ${options.slot}`,
        weight: 'Bolder',
        size: 'Medium',
        wrap: true,
      },
      { type: 'TextBlock', text: options.place, isSubtle: true, wrap: true, spacing: 'None' },
      {
        type: 'FactSet',
        facts: others.map((m) => ({ title: m.displayName, value: `${m.title}, ${m.department}` })),
      },
      {
        type: 'TextBlock',
        text: statusLine(options.status),
        wrap: true,
        color:
          options.status === 'declined'
            ? 'Attention'
            : options.status === 'accepted'
              ? 'Good'
              : 'Default',
      },
    ],
    actions: [
      ...(options.canReply
        ? [
            {
              type: 'Action.Execute',
              title: "I'll be there",
              verb: 'rsvp',
              data: { tableId: options.tableId, status: 'accepted' },
            },
            {
              type: 'Action.Execute',
              title: "Can't make it",
              verb: 'rsvp',
              data: { tableId: options.tableId, status: 'declined' },
            },
          ]
        : []),
      { type: 'Action.OpenUrl', title: 'Open the table', url: options.confirmUrl },
    ],
  };
}

function statusLine(status: RsvpStatus): string {
  if (status === 'accepted') return "You're coming.";
  if (status === 'declined') return "You told the table you can't make it.";
  return 'Let the table know whether you can make it.';
}

export function reminderCard(options: {
  date: string;
  officeId: string;
  dayLabel: string;
  officeName: string;
  closesAt: string;
  openUrl: string;
}): Card {
  return {
    $schema: SCHEMA,
    type: 'AdaptiveCard',
    version: '1.5',
    body: [
      {
        type: 'TextBlock',
        text: `Lunch with people from other teams, ${options.dayLabel}?`,
        weight: 'Bolder',
        wrap: true,
      },
      {
        type: 'TextBlock',
        text: `If you are at ${options.officeName} that day, you can be seated with two or three colleagues from other teams. Tables are made at ${options.closesAt} that morning.`,
        wrap: true,
      },
    ],
    actions: [
      {
        type: 'Action.Execute',
        title: 'Count me in',
        verb: 'want',
        data: { date: options.date, officeId: options.officeId },
      },
      { type: 'Action.OpenUrl', title: 'Open Sofra', url: options.openUrl },
    ],
  };
}

export function noticeCard(title: string, text: string, openUrl?: string): Card {
  return {
    $schema: SCHEMA,
    type: 'AdaptiveCard',
    version: '1.5',
    body: [
      { type: 'TextBlock', text: title, weight: 'Bolder', wrap: true },
      { type: 'TextBlock', text, wrap: true },
    ],
    actions: openUrl ? [{ type: 'Action.OpenUrl', title: 'Open Sofra', url: openUrl }] : [],
  };
}

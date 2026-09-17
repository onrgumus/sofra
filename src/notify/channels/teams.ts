import type { Employee } from '../../core/types';
import type { AccountResolver, Delivery, InviteChannel } from './types';
import { resolveEntraAccount } from './types';

export interface TeamsChannelOptions {
  /**
   * Confirms the caller has a credential that may actually post a message: a
   * bot backend, or a delegated token. Leaving it false is the honest default,
   * because app-only cannot do it and should fail now rather than at send time.
   */
  canSendMessages?: boolean;
  /**
   * Authenticated request against Microsoft Graph. Injected rather than built
   * here so this stays SDK-free and testable, and so the token strategy is the
   * caller's problem.
   */
  graph: (method: 'GET' | 'POST', path: string, body?: unknown) => Promise<Record<string, unknown>>;
  resolveAccount?: AccountResolver;
  /** Called when someone has no Teams account, so they can be mailed instead. */
  onUnreachable?: (employee: Employee, reason: string) => void;
}

/**
 * Creates a Teams group chat for the people at the table and posts the invite
 * into it as an Adaptive Card.
 *
 * Read this before wiring it up. Creating the chat works app-only: POST /chats
 * has an application permission, `Chat.Create`. Posting into it does not. The
 * Graph reference for POST /chats/{id}/messages lists exactly one application
 * permission, `Teamwork.Migrate.All`, which exists for importing history into a
 * chat in migration mode and is not a way to send a message; the "higher
 * privileged" column reads "Not available".
 *
 * So a client-credentials token cannot deliver this invite, and a nightly cron
 * has no signed-in user to borrow. The supported route for an app that posts
 * into a chat on its own schedule is a Teams bot sending a proactive message,
 * which means a Bot Framework registration and an endpoint to host, or a
 * delegated token belonging to a service account, which conditional access
 * tends to block.
 *
 * The adapter is kept because the shape is right and a bot backend slots in
 * behind `graph`, but `assertCanSend` refuses app-only credentials rather than
 * letting the failure arrive as a 403 at five in the evening. Slack has no such
 * restriction: `SlackChannel` works with a plain bot token.
 */
export class TeamsChannel implements InviteChannel {
  readonly name = 'teams';

  /** Chat ids by group, so an updated invite goes back to the same chat. */
  private readonly chats = new Map<string, string>();

  constructor(private readonly options: TeamsChannelOptions) {}

  async sendInvite(delivery: Delivery): Promise<void> {
    this.assertCanSend();
    const chatId = await this.chatFor(delivery);
    if (!chatId) return;
    await this.postCard(chatId, inviteCard(delivery));
  }

  async sendCancellation(delivery: Delivery): Promise<void> {
    this.assertCanSend();
    const chatId = await this.chatFor(delivery);
    if (!chatId) return;
    await this.postCard(chatId, cancellationCard(delivery));
  }

  private assertCanSend(): void {
    if (this.options.canSendMessages) return;
    throw new Error(
      'TeamsChannel cannot post with app-only credentials: POST /chats/{id}/messages has no ' +
        'application permission beyond Teamwork.Migrate.All. Supply a bot or delegated `graph` ' +
        'and set canSendMessages: true. See src/notify/channels/teams.ts.',
    );
  }

  private async chatFor(delivery: Delivery): Promise<string | null> {
    const existing = this.chats.get(delivery.groupId);
    if (existing) return existing;

    const resolve = this.options.resolveAccount ?? resolveEntraAccount;
    const members: Record<string, unknown>[] = [];

    for (const member of delivery.members) {
      const account = await resolve(member);
      if (!account) {
        this.options.onUnreachable?.(member, 'no Teams account for this person');
        continue;
      }
      members.push({
        '@odata.type': '#microsoft.graph.aadUserConversationMember',
        roles: ['owner'],
        'user@odata.bind': `https://graph.microsoft.com/v1.0/users('${account}')`,
      });
    }

    // Graph rejects a group chat with fewer than three members anyway.
    if (members.length < 3) return null;

    const chat = await this.options.graph('POST', '/chats', {
      chatType: 'group',
      topic: delivery.invite.subject,
      members,
    });

    const chatId = typeof chat['id'] === 'string' ? chat['id'] : null;
    if (chatId) this.chats.set(delivery.groupId, chatId);
    return chatId;
  }

  private async postCard(chatId: string, card: Record<string, unknown>): Promise<void> {
    await this.options.graph('POST', `/chats/${chatId}/messages`, {
      body: { contentType: 'html', content: '<attachment id="invite"></attachment>' },
      attachments: [
        {
          id: 'invite',
          contentType: 'application/vnd.microsoft.card.adaptive',
          content: JSON.stringify(card),
        },
      ],
    });
  }
}

function adaptiveCard(body: Record<string, unknown>[], actions: Record<string, unknown>[]) {
  return {
    $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
    type: 'AdaptiveCard',
    version: '1.4',
    body,
    ...(actions.length > 0 ? { actions } : {}),
  };
}

function inviteCard(delivery: Delivery): Record<string, unknown> {
  const { invite } = delivery;

  const body: Record<string, unknown>[] = [
    { type: 'TextBlock', text: invite.subject, weight: 'Bolder', size: 'Medium', wrap: true },
    {
      type: 'FactSet',
      facts: delivery.members.map((m) => ({
        title: m.displayName,
        value: `${m.title}, ${m.department}`,
      })),
    },
    { type: 'TextBlock', text: invite.text, wrap: true },
  ];

  const actions = invite.confirmUrl
    ? [{ type: 'Action.OpenUrl', title: 'Confirm or drop out', url: invite.confirmUrl }]
    : [];

  return adaptiveCard(body, actions);
}

function cancellationCard(delivery: Delivery): Record<string, unknown> {
  return adaptiveCard(
    [
      {
        type: 'TextBlock',
        text: delivery.invite.subject,
        weight: 'Bolder',
        size: 'Medium',
        wrap: true,
      },
      { type: 'TextBlock', text: delivery.invite.text, wrap: true },
    ],
    [],
  );
}

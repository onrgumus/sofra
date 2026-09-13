import type { Employee } from '../../core/types';
import type { AccountResolver, Delivery, InviteChannel } from './types';
import { resolveByEmail } from './types';

export interface SlackChannelOptions {
  /** Bot token. Needs `mpim:write`, `chat:write` and `users:read.email`. */
  token: string;
  resolveAccount?: AccountResolver;
  fetchImpl?: typeof fetch;
  /** Called when someone has no Slack account, so they can be mailed instead. */
  onUnreachable?: (employee: Employee, reason: string) => void;
}

interface SlackResponse {
  ok: boolean;
  error?: string;
  channel?: { id?: string };
  user?: { id?: string };
}

/**
 * Opens a group DM with exactly the people at the table and posts the invite
 * into it.
 *
 * The conversation is the feature. An email tells four people where to be; a
 * group chat lets them answer "shall we try the new place instead" without
 * anybody starting a thread of their own. The same chat is reused for the
 * cancellation, so the news lands where the plan was made.
 */
export class SlackChannel implements InviteChannel {
  readonly name = 'slack';

  constructor(private readonly options: SlackChannelOptions) {}

  async sendInvite(delivery: Delivery): Promise<void> {
    const channel = await this.openGroupChat(delivery);
    if (!channel) return;

    await this.post(channel, {
      text: `${delivery.invite.subject}\n\n${delivery.invite.text}`,
      blocks: inviteBlocks(delivery),
    });
  }

  async sendCancellation(delivery: Delivery): Promise<void> {
    const channel = await this.openGroupChat(delivery);
    if (!channel) return;

    await this.post(channel, {
      text: `${delivery.invite.subject}\n\n${delivery.invite.text}`,
      blocks: [section(`*${delivery.invite.subject}*\n\n${delivery.invite.text}`)],
    });
  }

  /**
   * `conversations.open` with several users is idempotent: the same set of
   * people always returns the same conversation, so re-sending an updated
   * invite does not spawn a second chat.
   */
  private async openGroupChat(delivery: Delivery): Promise<string | null> {
    const resolve = this.options.resolveAccount ?? resolveByEmail;
    const ids: string[] = [];

    for (const member of delivery.members) {
      const account = await resolve(member);
      const id = account ? await this.lookupUser(account) : null;
      if (!id) {
        this.options.onUnreachable?.(member, 'no Slack account for this person');
        continue;
      }
      ids.push(id);
    }

    // A "group" of one is a DM to yourself, which is not what anyone asked for.
    if (ids.length < 2) return null;

    const response = await this.call('conversations.open', { users: ids.join(',') });
    return response.channel?.id ?? null;
  }

  /** Slack wants its own user id; an email is what we have. */
  private async lookupUser(account: string): Promise<string | null> {
    if (!account.includes('@')) return account; // already a Slack id

    const response = await this.call('users.lookupByEmail', { email: account });
    return response.user?.id ?? null;
  }

  private async post(channel: string, body: Record<string, unknown>): Promise<void> {
    await this.call('chat.postMessage', { channel, ...body });
  }

  private async call(method: string, body: Record<string, unknown>): Promise<SlackResponse> {
    const doFetch = this.options.fetchImpl ?? fetch;
    const response = await doFetch(`https://slack.com/api/${method}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.options.token}`,
        'Content-Type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify(body),
    });

    // Slack answers 200 with ok:false, so the status alone proves nothing.
    const payload = (await response.json()) as SlackResponse;
    if (!payload.ok) throw new Error(`Slack ${method} failed: ${payload.error ?? 'unknown error'}`);
    return payload;
  }
}

function section(text: string): Record<string, unknown> {
  return { type: 'section', text: { type: 'mrkdwn', text } };
}

function inviteBlocks(delivery: Delivery): Record<string, unknown>[] {
  const { invite } = delivery;
  const blocks: Record<string, unknown>[] = [
    { type: 'header', text: { type: 'plain_text', text: invite.subject, emoji: true } },
    section(invite.text),
  ];

  if (invite.confirmUrl) {
    blocks.push({
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Confirm or drop out' },
          url: invite.confirmUrl,
        },
      ],
    });
  }
  return blocks;
}

import type { Employee } from '../core/types';
import type { Db } from '../db';
import { getTeamsConversation } from '../data/messages';
import { BASE_URL, confirmUrl } from '../lib/config';
import type { Delivery, InviteChannel } from '../notify/channels';
import type { Reminder } from '../notify/reminder';
import { cardAttachment, inviteCard, noticeCard, reminderCard, type Card } from './cards';
import type { BotConfig } from './config';
import { createConnector, type Connector } from './connector';

export interface TeamsBotChannelOptions {
  config: BotConfig;
  db: () => Db;
  connector?: Connector;
  onUnreachable?: (employee: Employee, reason: string) => void;
}

/**
 * Invites and questions as cards in each person's chat with the Sofra bot,
 * with the buttons on the card. Reaches the people who have the app; everyone
 * still gets the mail, so a person without it misses nothing.
 */
export class TeamsBotChannel implements InviteChannel {
  readonly name = 'teams-bot';
  private readonly connector: Connector;

  constructor(private readonly options: TeamsBotChannelOptions) {
    this.connector = options.connector ?? createConnector(options.config);
  }

  async sendInvite(delivery: Delivery): Promise<void> {
    const details = delivery.details;
    for (const member of delivery.members) {
      const card = details
        ? inviteCard({
            tableId: delivery.groupId,
            dayLabel: details.dayLabel,
            slot: details.slot,
            place: details.place,
            members: delivery.members,
            forEmployeeId: member.id,
            status: details.rsvps[member.id] ?? 'pending',
            confirmUrl: confirmUrl(delivery.groupId),
            canReply: details.canReply,
          })
        : noticeCard(
            delivery.invite.subject,
            delivery.invite.text.split('\n')[0] ?? '',
            confirmUrl(delivery.groupId),
          );
      await this.post(member, card);
    }
  }

  async sendCancellation(delivery: Delivery): Promise<void> {
    for (const member of delivery.members) {
      await this.post(
        member,
        noticeCard(
          delivery.invite.subject,
          'This lunch is off, and it has been taken off your calendar.',
          `${BASE_URL}/`,
        ),
      );
    }
  }

  async sendReminder(reminder: Reminder): Promise<void> {
    const card = reminder.offer
      ? reminderCard({ ...reminder.offer, openUrl: reminder.actionUrl })
      : noticeCard(reminder.subject, reminder.text, reminder.actionUrl);
    await this.post(reminder.employee, card);
  }

  private async post(employee: Employee, card: Card): Promise<void> {
    const ref = await getTeamsConversation(this.options.db(), employee.id);
    if (!ref) {
      this.options.onUnreachable?.(employee, 'has not installed the Sofra bot');
      return;
    }
    try {
      await this.connector.send(ref.serviceUrl, ref.conversationId, {
        type: 'message',
        attachments: [cardAttachment(card)],
      });
    } catch (error) {
      // One person with the app removed must not cost the rest their card.
      this.options.onUnreachable?.(employee, String(error));
    }
  }
}

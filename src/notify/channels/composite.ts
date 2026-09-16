import type { Reminder } from '../reminder';
import type { Delivery, InviteChannel } from './types';

/**
 * Sends through several channels. One being down does not cancel lunch: the
 * failure is reported and the others still go out, because a table that heard
 * about it by email is better off than a table that heard nothing because Slack
 * was having an afternoon.
 */
export class CompositeChannel implements InviteChannel {
  readonly name = 'composite';

  constructor(
    private readonly channels: readonly InviteChannel[],
    private readonly onError: (channel: string, error: unknown) => void = () => {},
  ) {}

  async sendInvite(delivery: Delivery): Promise<void> {
    await this.each((channel) => channel.sendInvite(delivery));
  }

  async sendCancellation(delivery: Delivery): Promise<void> {
    await this.each((channel) => channel.sendCancellation(delivery));
  }

  /**
   * The first channel that can reach this person, not all of them. An invite
   * going out twice is a duplicate of something they wanted; a reminder going
   * out twice is being asked the same question twice by the same company.
   */
  async sendReminder(reminder: Reminder): Promise<void> {
    for (const channel of this.channels) {
      if (!channel.sendReminder) continue;
      try {
        await channel.sendReminder(reminder);
        return;
      } catch (error) {
        this.onError(channel.name, error);
      }
    }
  }

  private async each(run: (channel: InviteChannel) => Promise<void>): Promise<void> {
    for (const channel of this.channels) {
      try {
        await run(channel);
      } catch (error) {
        this.onError(channel.name, error);
      }
    }
  }
}

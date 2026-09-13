import { sendInvite, type EmailTransport } from '../transport';
import type { Delivery, InviteChannel } from './types';

export interface EmailChannelOptions {
  transport: EmailTransport;
  from: string;
  /** One mail to the whole table, or one each. The shared thread is the default. */
  mode?: 'single-thread' | 'individual';
}

/**
 * Email, which is the channel that works at every company without asking anyone
 * for permission. The other channels are nicer where they are available.
 */
export class EmailChannel implements InviteChannel {
  readonly name = 'email';

  constructor(private readonly options: EmailChannelOptions) {}

  async sendInvite(delivery: Delivery): Promise<void> {
    await this.send(delivery);
  }

  async sendCancellation(delivery: Delivery): Promise<void> {
    await this.send(delivery);
  }

  private async send(delivery: Delivery): Promise<void> {
    await sendInvite(this.options.transport, delivery.invite, {
      from: this.options.from,
      mode: this.options.mode ?? 'single-thread',
    });
  }
}

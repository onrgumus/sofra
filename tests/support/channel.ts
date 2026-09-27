import type { Delivery, InviteChannel } from '../../src/notify/channels';
import type { Reminder } from '../../src/notify/reminder';

/** A channel that remembers what it was asked to send, instead of sending it. */
export class RecordingChannel implements InviteChannel {
  readonly name = 'recording';
  invites: Delivery[] = [];
  cancellations: Delivery[] = [];
  reminders: Reminder[] = [];
  /** Addresses whose messages throw, to test that one failure stops nothing else. */
  failFor = new Set<string>();

  async sendInvite(delivery: Delivery): Promise<void> {
    this.check(delivery.members.map((m) => m.email));
    this.invites.push(delivery);
  }

  async sendCancellation(delivery: Delivery): Promise<void> {
    this.check(delivery.members.map((m) => m.email));
    this.cancellations.push(delivery);
  }

  async sendReminder(reminder: Reminder): Promise<void> {
    this.check([reminder.employee.email]);
    this.reminders.push(reminder);
  }

  clear(): void {
    this.invites = [];
    this.cancellations = [];
    this.reminders = [];
  }

  private check(addresses: string[]): void {
    const failing = addresses.find((a) => this.failFor.has(a));
    if (failing) throw new Error(`mailbox unavailable: ${failing}`);
  }
}

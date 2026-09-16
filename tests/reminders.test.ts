import { beforeEach, describe, expect, it } from 'vitest';
import { DemoStore, SLOT } from '../src/store/demo';
import { sendReminders, REMINDER_KIND } from '../src/lib/reminders';
import { buildReminder } from '../src/notify/reminder';
import type { Reminder } from '../src/notify/reminder';
import type { Delivery, InviteChannel } from '../src/notify/channels';
import { nextWeekday, todayInZone } from '../src/lib/dates';
import { employee } from './helpers';

const OFFICE = 'IST-HQ';

/** Records who was asked, and can be told to fail for one person. */
class RecordingChannel implements InviteChannel {
  readonly name = 'recording';
  readonly reminded: Reminder[] = [];

  constructor(private readonly failFor: ReadonlySet<string> = new Set()) {}

  async sendInvite(_delivery: Delivery): Promise<void> {}
  async sendCancellation(_delivery: Delivery): Promise<void> {}

  async sendReminder(reminder: Reminder): Promise<void> {
    if (this.failFor.has(reminder.employee.id)) throw new Error('mailbox does not exist');
    this.reminded.push(reminder);
  }
}

/** A channel that can only address a table, like a group-chat-only integration. */
class TableOnlyChannel implements InviteChannel {
  readonly name = 'table-only';
  async sendInvite(_delivery: Delivery): Promise<void> {}
  async sendCancellation(_delivery: Delivery): Promise<void> {}
}

describe('the daily question', () => {
  let store: DemoStore;
  let tomorrow: string;

  beforeEach(async () => {
    store = new DemoStore(7, 80);
    const office = (await store.getOffice(OFFICE))!;
    tomorrow = nextWeekday(todayInZone(office.timeZone));
  });

  it('asks the people who will be in the building and nobody else', async () => {
    const channel = new RecordingChannel();

    // Across every office, so nobody is asked about a building they are not in.
    const attending = new Set<string>();
    for (const office of await store.listOffices()) {
      for (const id of await store.getAttendance(tomorrow, office.id)) attending.add(id);
    }

    const outcomes = await sendReminders({ store, channel, date: tomorrow });

    expect(channel.reminded.length).toBeGreaterThan(0);
    expect(outcomes.reduce((n, o) => n + o.sent, 0)).toBe(channel.reminded.length);
    for (const reminder of channel.reminded) {
      expect(attending.has(reminder.employee.id)).toBe(true);
    }
  });

  it('does not ask somebody who has already said yes', async () => {
    const channel = new RecordingChannel();
    const keen = (await store.getAttendance(tomorrow, OFFICE))[0]!;
    await store.setOptIn({ employeeId: keen, date: tomorrow, officeId: OFFICE, slot: SLOT });

    const outcomes = await sendReminders({ store, channel, date: tomorrow });

    expect(channel.reminded.some((r) => r.employee.id === keen)).toBe(false);
    expect(outcomes.reduce((n, o) => n + o.alreadyIn, 0)).toBeGreaterThanOrEqual(1);
  });

  it('asks once, however many times the job runs', async () => {
    // A retried cron, or a second schedule somebody adds, must not mail the
    // whole building a second time about the same lunch.
    const first = new RecordingChannel();
    await sendReminders({ store, channel: first, date: tomorrow });

    const second = new RecordingChannel();
    const outcomes = await sendReminders({ store, channel: second, date: tomorrow });

    expect(second.reminded).toEqual([]);
    expect(outcomes.reduce((n, o) => n + o.sent, 0)).toBe(0);
    expect(outcomes.reduce((n, o) => n + o.alreadyAsked, 0)).toBe(first.reminded.length);
  });

  it('honours an opt-out', async () => {
    const channel = new RecordingChannel();
    const quiet = (await store.getAttendance(tomorrow, OFFICE))[0]!;
    await store.setReminders(quiet, false);

    const outcomes = await sendReminders({ store, channel, date: tomorrow });

    expect(channel.reminded.some((r) => r.employee.id === quiet)).toBe(false);
    expect(outcomes.reduce((n, o) => n + o.optedOut, 0)).toBe(1);
  });

  it('retries tomorrow the person whose address bounced today', async () => {
    // Recording a failed send as "asked" would silently drop somebody from the
    // product on the strength of one bad address.
    const bad = (await store.getAttendance(tomorrow, OFFICE))[0]!;
    const failing = new RecordingChannel(new Set([bad]));

    const outcomes = await sendReminders({ store, channel: failing, date: tomorrow });
    expect(outcomes.flatMap((o) => o.failed)).toEqual([
      { employeeId: bad, reason: 'mailbox does not exist' },
    ]);
    expect(await store.listNotified(REMINDER_KIND, tomorrow, OFFICE)).not.toContain(bad);

    const working = new RecordingChannel();
    await sendReminders({ store, channel: working, date: tomorrow });
    expect(working.reminded.map((r) => r.employee.id)).toEqual([bad]);
  });

  it('sends nothing at all through a channel that cannot address one person', async () => {
    const outcomes = await sendReminders({
      store,
      channel: new TableOnlyChannel(),
      date: tomorrow,
    });

    expect(outcomes).toEqual([]);
    expect(await store.listNotified(REMINDER_KIND, tomorrow, OFFICE)).toEqual([]);
  });

  it('asks about tomorrow, not about a lunch three hours away', async () => {
    // Running in the morning about the same day would be a question nobody has
    // time to act on, and matching has not run for that day yet anyway.
    const channel = new RecordingChannel();

    const outcomes = await sendReminders({ store, channel });

    for (const outcome of outcomes) {
      const office = (await store.getOffice(outcome.officeId))!;
      expect(outcome.date).toBe(nextWeekday(todayInZone(office.timeZone)));
    }
  });

  it('covers every office, not just the first', async () => {
    const channel = new RecordingChannel();
    const offices = await store.listOffices();

    const outcomes = await sendReminders({ store, channel, date: tomorrow });

    expect(outcomes.map((o) => o.officeId).sort()).toEqual(offices.map((o) => o.id).sort());
  });
});

describe('what the message says', () => {
  const venue = {
    officeId: OFFICE,
    displayName: 'Istanbul HQ',
    timeZone: 'Europe/Istanbul',
    meetingPoint: 'Ground floor cafeteria',
  };

  function build(languages: string[]) {
    return buildReminder({
      employee: employee('e0001', { displayName: 'Deniz Arslan', languages }),
      venue,
      date: '2026-09-17',
      dayLabel: 'Thu 17 Sep',
      optInUrl: 'https://sofra.example.com/?day=2026-09-17',
      settingsUrl: 'https://sofra.example.com/you',
    });
  }

  it('says why it arrived and how to stop it', async () => {
    const reminder = build(['en']);

    expect(reminder.text).toContain('desk booking');
    expect(reminder.text).toContain('https://sofra.example.com/you');
  });

  it('offers exactly one thing to do, and links to the day it is about', async () => {
    const reminder = build(['en']);

    expect(reminder.actionUrl).toBe('https://sofra.example.com/?day=2026-09-17');
    expect(reminder.html).toContain(reminder.actionUrl);
  });

  it('is written in a language the reader speaks', async () => {
    expect(build(['tr']).subject).toContain('öğle yemeği');
    expect(build(['tr', 'en']).subject).toContain('Lunch');
  });

  it('greets someone by the name they go by, not their full record', async () => {
    expect(build(['en']).text).toContain('Hi Deniz,');
  });
});

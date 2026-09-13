import { describe, expect, it } from 'vitest';
import { deliverPending } from '../src/lib/notifications';
import { planDay } from '../src/lib/nightly';
import { DemoStore } from '../src/store/demo';
import { todayInZone, upcomingWeekdays } from '../src/lib/dates';
import type { EmailMessage, EmailTransport } from '../src/notify/transport';
import { EmailChannel } from '../src/notify/channels';

const OFFICE = 'IST-HQ';
const from = 'sofra@example.com';

function recorder() {
  const sent: EmailMessage[] = [];
  const transport: EmailTransport = {
    name: 'recorder',
    async send(message) {
      sent.push(message);
    },
  };
  return { sent, channel: new EmailChannel({ transport, from }) };
}

async function setUp() {
  const store = new DemoStore(7, 160);
  const date = upcomingWeekdays(1, todayInZone('Europe/Istanbul'))[0]!;
  await planDay(store, OFFICE, date);
  return { store, date, ...recorder() };
}

describe('deliverPending', () => {
  it('sends an invite for every table that has not had one', async () => {
    const { store, date, channel, sent } = await setUp();

    const result = await deliverPending({ store, channel, from, date, officeId: OFFICE });

    expect(result.invitesSent).toBe(store.listGroups(date, OFFICE).length);
    expect(result.cancellationsSent).toBe(0);
    expect(sent.every((m) => m.attachments?.[0]?.content.includes('METHOD:REQUEST'))).toBe(true);
  });

  it('is idempotent — running twice does not mail anyone twice', async () => {
    const { store, date, channel, sent } = await setUp();

    await deliverPending({ store, channel, from, date, officeId: OFFICE });
    const countAfterFirst = sent.length;
    const second = await deliverPending({ store, channel, from, date, officeId: OFFICE });

    expect(second.invitesSent).toBe(0);
    expect(sent).toHaveLength(countAfterFirst);
  });

  it('takes a cancelled lunch back off the calendar', async () => {
    const { store, date, channel, sent } = await setUp();
    await deliverPending({ store, channel, from, date, officeId: OFFICE });
    sent.length = 0;

    const group = store.listGroups(date, OFFICE).find((g) => g.members.length === 4)!;
    store.setRsvp(group.id, group.members[0]!.id, 'declined');
    store.setRsvp(group.id, group.members[1]!.id, 'declined');

    const result = await deliverPending({ store, channel, from, date, officeId: OFFICE });

    expect(result.cancellationsSent).toBe(1);
    const cancellation = sent.find((m) => m.subject.includes('cancelled'))!;
    expect(cancellation).toBeDefined();
    // METHOD:CANCEL is what actually removes it from a calendar client.
    expect(cancellation.attachments?.[0]?.content).toContain('METHOD:CANCEL');
    expect(cancellation.attachments?.[0]?.content).toContain('STATUS:CANCELLED');
  });

  it('re-invites the tables that absorbed the stranded people', async () => {
    const { store, date, channel, sent } = await setUp();
    await deliverPending({ store, channel, from, date, officeId: OFFICE });
    sent.length = 0;

    const group = store.listGroups(date, OFFICE).find((g) => g.members.length === 4)!;
    store.setRsvp(group.id, group.members[0]!.id, 'declined');
    store.setRsvp(group.id, group.members[1]!.id, 'declined');

    const result = await deliverPending({ store, channel, from, date, officeId: OFFICE });

    expect(result.invitesSent).toBeGreaterThan(0);
    const updates = sent.filter((m) => !m.subject.includes('cancelled'));
    // A bumped sequence is how a calendar updates the event instead of adding one.
    expect(updates.every((m) => /SEQUENCE:[1-9]/.test(m.attachments?.[0]?.content ?? ''))).toBe(
      true,
    );
  });

  it('never cancels a table nobody was told about', async () => {
    const { store, date, channel, sent } = await setUp();

    const group = store.listGroups(date, OFFICE).find((g) => g.members.length === 4)!;
    store.setRsvp(group.id, group.members[0]!.id, 'declined');
    store.setRsvp(group.id, group.members[1]!.id, 'declined');

    const result = await deliverPending({ store, channel, from, date, officeId: OFFICE });

    expect(result.cancellationsSent).toBe(0);
    expect(sent.some((m) => m.subject.includes('cancelled'))).toBe(false);
  });

  it('does not send a cancellation twice', async () => {
    const { store, date, channel, sent } = await setUp();
    await deliverPending({ store, channel, from, date, officeId: OFFICE });

    const group = store.listGroups(date, OFFICE).find((g) => g.members.length === 4)!;
    store.setRsvp(group.id, group.members[0]!.id, 'declined');
    store.setRsvp(group.id, group.members[1]!.id, 'declined');

    await deliverPending({ store, channel, from, date, officeId: OFFICE });
    sent.length = 0;
    const again = await deliverPending({ store, channel, from, date, officeId: OFFICE });

    expect(again.cancellationsSent).toBe(0);
    expect(sent).toHaveLength(0);
  });

  it('addresses the cancellation to the people who were left on the table', async () => {
    const { store, date, channel, sent } = await setUp();
    await deliverPending({ store, channel, from, date, officeId: OFFICE });
    sent.length = 0;

    const group = store.listGroups(date, OFFICE).find((g) => g.members.length === 4)!;
    store.setRsvp(group.id, group.members[0]!.id, 'declined');
    store.setRsvp(group.id, group.members[1]!.id, 'declined');
    await deliverPending({ store, channel, from, date, officeId: OFFICE });

    const cancellation = sent.find((m) => m.subject.includes('cancelled'))!;
    const remaining = store.getGroup(group.id)!.members.map((m) => m.email);
    expect(cancellation.to.sort()).toEqual(remaining.sort());
  });

  it('says nothing to do for an office with no tables', async () => {
    const { store, channel, sent } = await setUp();
    const empty = upcomingWeekdays(5, todayInZone('Europe/Istanbul'))[4]!;

    const result = await deliverPending({ store, channel, from, date: empty, officeId: OFFICE });

    expect(result).toEqual({ invitesSent: 0, cancellationsSent: 0 });
    expect(sent).toHaveLength(0);
  });
});

import { describe, expect, it } from 'vitest';
import { runNightlyMatching } from '../src/lib/nightly';
import { DemoStore, SLOT } from '../src/store/demo';
import { todayInZone, upcomingWeekdays } from '../src/lib/dates';
import type { EmailMessage, EmailTransport } from '../src/notify/transport';
import { EmailChannel } from '../src/notify/channels';

function recorder() {
  const sent: EmailMessage[] = [];
  const transport: EmailTransport = {
    name: 'recorder',
    async send(m) {
      sent.push(m);
    },
  };
  return { sent, channel: new EmailChannel({ transport, from }) };
}

const from = 'sofra@example.com';

describe('runNightlyMatching', () => {
  it('matches every office and mails one invite per table', async () => {
    const store = new DemoStore(7, 160);
    const { channel, sent } = recorder();

    const outcomes = await runNightlyMatching({ store, channel, from });

    expect(outcomes).toHaveLength(store.listOffices().length);
    for (const outcome of outcomes) {
      expect(outcome.tables).toBeGreaterThan(0);
      expect(outcome.unseated).toBe(0);
      expect(outcome.invitesSent).toBe(outcome.tables);
    }
    expect(sent).toHaveLength(outcomes.reduce((total, o) => total + o.tables, 0));
  });

  it('addresses each mail to a whole table', async () => {
    const store = new DemoStore(7, 160);
    const { channel, sent } = recorder();

    await runNightlyMatching({ store, channel, from });

    for (const message of sent) {
      expect(message.to.length).toBeGreaterThanOrEqual(3);
      expect(message.to.length).toBeLessThanOrEqual(4);
      expect(message.attachments?.[0]?.contentType).toContain('text/calendar');
    }
  });

  it('only seats people who are actually in the building', async () => {
    const store = new DemoStore(7, 160);
    const { channel } = recorder();

    const [outcome] = await runNightlyMatching({ store, channel, from });
    const attending = new Set(await store.getAttendance(outcome!.date, outcome!.officeId));

    for (const group of store.listGroups(outcome!.date, outcome!.officeId)) {
      for (const member of group.members) expect(attending.has(member.id)).toBe(true);
    }
  });

  it('plans a specific day when asked, which is how it is tested at all', async () => {
    const store = new DemoStore(7, 160);
    const { channel } = recorder();
    const date = upcomingWeekdays(3, todayInZone('Europe/Istanbul'))[2]!;

    const outcomes = await runNightlyMatching({ store, channel, from, date });

    expect(outcomes.every((o) => o.date === date)).toBe(true);
    expect(store.listGroups(date, 'IST-HQ').length).toBeGreaterThan(0);
  });

  it('marks the invites as sent, so the console does not offer to send them twice', async () => {
    const store = new DemoStore(7, 160);
    const { channel } = recorder();

    const [outcome] = await runNightlyMatching({ store, channel, from });

    for (const group of store.listGroups(outcome!.date, outcome!.officeId)) {
      expect(group.invitesSentAt).not.toBeNull();
    }
  });

  it('running twice replaces the plan rather than doubling it', async () => {
    const store = new DemoStore(7, 160);
    const { channel } = recorder();

    const [first] = await runNightlyMatching({ store, channel, from });
    const [second] = await runNightlyMatching({ store, channel, from });

    expect(second!.seated).toBe(first!.seated);
    expect(store.listGroups(first!.date, first!.officeId)).toHaveLength(second!.tables);
  });

  it('says nothing happened rather than failing when nobody asked', async () => {
    const store = new DemoStore(7, 160);
    const { channel, sent } = recorder();
    const date = upcomingWeekdays(1, todayInZone('Europe/Istanbul'))[0]!;

    for (const office of store.listOffices()) {
      for (const optIn of store.listOptIns(date, office.id)) {
        store.removeOptIn(optIn.employeeId, date, office.id);
      }
    }

    const outcomes = await runNightlyMatching({ store, channel, from, date });
    expect(outcomes.every((o) => o.tables === 0 && o.optedIn === 0)).toBe(true);
    expect(sent).toHaveLength(0);
  });

  it('uses the slot the rest of the app uses', async () => {
    const store = new DemoStore(7, 160);
    const { channel } = recorder();

    const [outcome] = await runNightlyMatching({ store, channel, from });
    expect(store.listGroups(outcome!.date, outcome!.officeId)[0]?.slot).toBe(SLOT);
  });
});

import { describe, expect, it } from 'vitest';
import { buildUnseated } from '../src/notify/unseated';
import { deliverPending, UNSEATED_KIND } from '../src/lib/notifications';
import { DemoStore, SLOT } from '../src/store/demo';
import { planDay } from '../src/lib/nightly';
import { nextWeekday, todayInZone } from '../src/lib/dates';
import type { Delivery, InviteChannel } from '../src/notify/channels';
import type { Reminder } from '../src/notify/reminder';
import { employee } from './helpers';

const VENUE = {
  officeId: 'IST-HQ',
  displayName: 'Istanbul HQ',
  timeZone: 'Europe/Istanbul',
  meetingPoint: 'Cafeteria',
};

class Recorder implements InviteChannel {
  readonly name = 'recorder';
  readonly reminded: Reminder[] = [];
  async sendInvite(_d: Delivery): Promise<void> {}
  async sendCancellation(_d: Delivery): Promise<void> {}
  async sendReminder(r: Reminder): Promise<void> {
    this.reminded.push(r);
  }
}

describe('what an unseated person is told', () => {
  function build(reason: 'no-common-language' | 'pool-too-small', languages = ['en']) {
    return buildUnseated({
      employee: employee('e1', { displayName: 'Deniz Arslan', languages }),
      venue: VENUE,
      reason,
      dayLabel: 'Thu 17 Sept',
      settingsUrl: 'https://sofra.example.com/you',
    });
  }

  it('says it was the day, not them, when too few people asked', () => {
    // The conclusion otherwise available is that three colleagues were asked
    // and none of them wanted to come.
    const message = build('pool-too-small');

    expect(message.text).toContain('Too few people asked');
    expect(message.text).toContain('rather than anything to do with you');
    expect(message.text).not.toMatch(/sorry|unfortunately|regret/i);
  });

  it('points at the fix when the problem is language', () => {
    const message = build('no-common-language');

    expect(message.text).toContain('shares a language with you');
    expect(message.text).toContain('https://sofra.example.com/you');
  });

  it('names the day it is about', () => {
    expect(build('pool-too-small').subject).toContain('Thu 17 Sept');
  });

  it('writes in a language the reader speaks', () => {
    expect(build('no-common-language', ['tr']).text).toContain('ortak bir dilin yok');
    expect(build('pool-too-small', ['tr']).subject).toContain('masa çıkmadı');
  });
});

describe('telling them', () => {
  async function dayWithNobodyMatchable() {
    const store = new DemoStore(7, 40);
    const office = (await store.getOffice('IST-HQ'))!;
    const date = nextWeekday(todayInZone(office.timeZone));

    // One person, so no table of three is possible.
    for (const optIn of await store.listOptIns(date, 'IST-HQ')) {
      await store.removeOptIn(optIn.employeeId, date, 'IST-HQ');
    }
    const alone = (await store.getAttendance(date, 'IST-HQ'))[0]!;
    await store.setOptIn({ employeeId: alone, date, officeId: 'IST-HQ', slot: SLOT });
    await planDay(store, 'IST-HQ', date);

    return { store, date, alone };
  }

  it('mails the person the engine could not seat', async () => {
    const { store, date, alone } = await dayWithNobodyMatchable();
    const channel = new Recorder();

    const result = await deliverPending({
      store,
      channel,
      from: 'sofra@example.com',
      date,
      officeId: 'IST-HQ',
    });

    expect(result.unseatedTold).toBe(1);
    expect(channel.reminded[0]?.employee.id).toBe(alone);
  });

  it('tells them once, however often delivery runs', async () => {
    const { store, date } = await dayWithNobodyMatchable();
    const options = { store, from: 'sofra@example.com', date, officeId: 'IST-HQ' };

    await deliverPending({ ...options, channel: new Recorder() });
    const second = new Recorder();
    const result = await deliverPending({ ...options, channel: second });

    expect(second.reminded).toEqual([]);
    expect(result.unseatedTold).toBe(0);
  });

  it('records it only after a send succeeds', async () => {
    const { store, date, alone } = await dayWithNobodyMatchable();
    const failing: InviteChannel = {
      name: 'failing',
      sendInvite: async () => {},
      sendCancellation: async () => {},
      sendReminder: async () => {
        throw new Error('mailbox does not exist');
      },
    };

    const result = await deliverPending({
      store,
      channel: failing,
      from: 'sofra@example.com',
      date,
      officeId: 'IST-HQ',
    });

    expect(result.failed[0]?.groupId).toBe(`unseated:${alone}`);
    expect(await store.listNotified(UNSEATED_KIND, date, 'IST-HQ')).toEqual([]);
  });

  it('says nothing on a day that has not been planned yet', async () => {
    // No table because matching has not run is not the same as no table
    // because there was nowhere to put you.
    const store = new DemoStore(7, 40);
    const office = (await store.getOffice('IST-HQ'))!;
    const date = nextWeekday(todayInZone(office.timeZone));
    const channel = new Recorder();

    const result = await deliverPending({
      store,
      channel,
      from: 'sofra@example.com',
      date,
      officeId: 'IST-HQ',
    });

    expect(result.unseatedTold).toBe(0);
    expect(channel.reminded).toEqual([]);
  });
});

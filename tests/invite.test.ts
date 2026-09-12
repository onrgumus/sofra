import { describe, expect, it } from 'vitest';
import { buildInvite, pickTopic } from '../src/notify/invite';
import { ConsoleTransport, sendInvite, type EmailMessage, type EmailTransport } from '../src/notify/transport';
import type { MatchedGroup } from '../src/core/types';
import { employee } from './helpers';

const VENUE = {
  officeId: 'IST-HQ',
  displayName: 'Istanbul HQ',
  timeZone: 'Europe/Istanbul',
  meetingPoint: 'Ground floor cafeteria',
};

function group(overrides: Partial<MatchedGroup> = {}): MatchedGroup {
  return {
    id: '2026-09-16-IST-HQ-12:00-1',
    date: '2026-09-16',
    officeId: 'IST-HQ',
    slot: '12:00',
    members: [
      employee('a', { displayName: 'Ada Yılmaz', department: 'Engineering', team: 'Engineering/Platform' }),
      employee('b', { displayName: 'Bruno Costa', department: 'Sales', team: 'Sales/SMB' }),
      employee('c', { displayName: 'Chloe Kaya', department: 'Design', team: 'Design/Research' }),
      employee('d', { displayName: 'Deniz Novak', department: 'Finance', team: 'Finance/FP&A' }),
    ],
    score: 3,
    relaxation: 'none',
    dietary: [],
    commonLanguages: ['en'],
    ...overrides,
  };
}

const organizer = { name: 'Sofra', email: 'sofra@example.com' };

describe('buildInvite', () => {
  const invite = buildInvite({ group: group(), venue: VENUE, organizer });

  it('addresses the whole table in one mail', () => {
    expect(invite.to.map((a) => a.email)).toEqual(['a@example.com', 'b@example.com', 'c@example.com', 'd@example.com']);
    expect(invite.text).toContain('The 4 of you are having lunch together at 12:00');
    expect(invite.text).toContain('This mail went to all 4 of you at once');
  });

  it('tells people to introduce themselves and their team first', () => {
    expect(invite.text).toContain('How to start');
    expect(invite.text).toContain('which team you are on');
    expect(invite.text).toContain('what you were doing before you got here');
  });

  it('gives the table a topic', () => {
    expect(invite.text).toContain("Today's topic");
    expect(invite.topic.length).toBeGreaterThan(10);
    expect(invite.text).toContain(invite.topic);
  });

  it('lists everyone with their department and team', () => {
    expect(invite.text).toContain('• Ada Yılmaz — Specialist, Engineering (Platform)');
    expect(invite.text).toContain('• Deniz Novak — Specialist, Finance (FP&A)');
  });

  it('writes in a language the whole table shares', () => {
    const turkish = buildInvite({
      group: group({ commonLanguages: ['tr', 'en'] }),
      venue: VENUE,
      organizer,
    });
    expect(turkish.subject).toContain('öğle yemeği');
    expect(turkish.subject).toContain('dördünüz');
    expect(turkish.text).toContain('Bugünün konusu');
    expect(turkish.text).toContain('hangi ekipte olduğunuz');
  });

  it('mentions dietary needs only when the table has some', () => {
    expect(invite.text).not.toContain('Dietary needs');
    const withNeeds = buildInvite({ group: group({ dietary: ['vegan'] }), venue: VENUE, organizer });
    expect(withNeeds.text).toContain('Dietary needs at this table');
    expect(withNeeds.text).toContain('vegan');
  });

  it('says how many people are at the table in the subject', () => {
    expect(invite.subject).toBe('Lunch today at 12:00 — the four of you');
    const threeSome = buildInvite({
      group: group({ members: group().members.slice(0, 3) }),
      venue: VENUE,
      organizer,
    });
    expect(threeSome.subject).toBe('Lunch today at 12:00 — the three of you');
    expect(threeSome.text).toContain('The 3 of you are having lunch together');
  });

  it('carries the same text into the calendar attachment', () => {
    expect(invite.ics).toContain('DESCRIPTION:');
    expect(invite.ics).toContain('METHOD:REQUEST');
  });
});

describe('pickTopic', () => {
  it('is stable for a group, so re-sending does not change the topic', () => {
    expect(pickTopic('group-1', 'en')).toBe(pickTopic('group-1', 'en'));
  });

  it('varies across tables on the same day', () => {
    const topics = new Set(
      ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => pickTopic(`2026-09-16-IST-HQ-12:00-${id}`, 'en')),
    );
    expect(topics.size).toBeGreaterThan(1);
  });

  it('has a topic list in both languages', () => {
    expect(pickTopic('group-1', 'tr')).not.toBe(pickTopic('group-1', 'en'));
  });
});

describe('sendInvite', () => {
  function recorder(): { transport: EmailTransport; sent: EmailMessage[] } {
    const sent: EmailMessage[] = [];
    return {
      sent,
      transport: {
        name: 'recorder',
        async send(message) {
          sent.push(message);
        },
      },
    };
  }

  it('sends one mail to all four by default', async () => {
    const { transport, sent } = recorder();
    await sendInvite(transport, buildInvite({ group: group(), venue: VENUE, organizer }), {
      from: 'sofra@example.com',
    });

    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toHaveLength(4);
    expect(sent[0]!.attachments?.[0]?.contentType).toContain('text/calendar');
  });

  it('can fall back to individual mails where a shared thread is unwanted', async () => {
    const { transport, sent } = recorder();
    await sendInvite(transport, buildInvite({ group: group(), venue: VENUE, organizer }), {
      from: 'sofra@example.com',
      mode: 'individual',
    });

    expect(sent).toHaveLength(4);
    expect(sent.every((m) => m.to.length === 1)).toBe(true);
  });

  it('works with the console transport used in development', async () => {
    await expect(
      sendInvite(new ConsoleTransport(), buildInvite({ group: group(), venue: VENUE, organizer }), {
        from: 'sofra@example.com',
      }),
    ).resolves.toBeUndefined();
  });
});

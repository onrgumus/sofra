import { describe, expect, it } from 'vitest';
import { buildInvite, pickTopic } from '../src/notify/invite';
import {
  ConsoleTransport,
  sendInvite,
  type EmailMessage,
  type EmailTransport,
} from '../src/notify/transport';
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
      employee('a', {
        displayName: 'Ada Yılmaz',
        department: 'Engineering',
        team: 'Engineering/Platform',
      }),
      employee('b', { displayName: 'Bruno Costa', department: 'Sales', team: 'Sales/SMB' }),
      employee('c', { displayName: 'Chloe Kaya', department: 'Design', team: 'Design/Research' }),
      employee('d', { displayName: 'Deniz Novak', department: 'Finance', team: 'Finance/FP&A' }),
    ],
    score: 3,
    relaxation: 'none',
    commonLanguages: ['en'],
    ...overrides,
  };
}

const organizer = { name: 'Sofra', email: 'sofra@example.com' };

describe('buildInvite', () => {
  const invite = buildInvite({ group: group(), venue: VENUE, organizer });

  it('addresses the whole table in one mail', () => {
    expect(invite.to.map((a) => a.email)).toEqual([
      'a@example.com',
      'b@example.com',
      'c@example.com',
      'd@example.com',
    ]);
    expect(invite.text).toContain(
      'The 4 of you are having lunch together on Wednesday 16 September at 12:00',
    );
    expect(invite.text).toContain('This mail went to all 4 of you at once');
  });

  it('opens with a round of introductions covering work, history and hobbies', () => {
    expect(invite.text).toContain('How to start');
    expect(invite.text).toContain('How long you have been here');
    expect(invite.text).toContain('Which project you are on right now');
    expect(invite.text).toContain('before this job');
    expect(invite.text).toContain('Your hobbies');
    expect(invite.text).toContain('happier about coming into the office');
    expect(invite.text).toContain('we could be doing better');
  });

  it('tells the table not to spend the hour on work', () => {
    expect(invite.text).toContain('do not let it turn into a work meeting');
    expect(invite.text).toMatch(/sport/i);
    expect(invite.text).toMatch(/music and films/i);
    expect(invite.text).toContain('what you actually care about');
  });

  it('gives the table a topic', () => {
    expect(invite.text).toContain('Your topic');
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
    expect(turkish.text).toContain('Masanızın konusu');
    expect(turkish.text).toContain('Hobilerin neler');
    expect(turkish.text).toContain('Ne kadar zamandır buradasın');
    expect(turkish.text).toContain('spor, müzik ve filmler');
  });

  it('never publishes what anyone eats', () => {
    // Dietary needs reveal religion and health — special categories under GDPR
    // Art. 9 and KVKK Art. 6 — and this mail goes to three colleagues at once.
    // The table sorts the venue out by replying to each other instead.
    expect(invite.text).not.toMatch(/dietary|vegan|vegetarian|halal|gluten/i);
  });

  it('says how many people are at the table in the subject', () => {
    expect(invite.subject).toBe('Lunch Wednesday 16 September at 12:00, the four of you');
    const threeSome = buildInvite({
      group: group({ members: group().members.slice(0, 3) }),
      venue: VENUE,
      organizer,
    });
    expect(threeSome.subject).toBe('Lunch Wednesday 16 September at 12:00, the three of you');
    expect(threeSome.text).toContain('The 3 of you are having lunch together');
  });

  it('names the day, because the invite arrives the evening before', () => {
    // It said "today" and went out at 17:00 the previous weekday, so it was
    // false for every person who read it. Nothing may say "today" again.
    expect(invite.subject).toContain('Wednesday 16 September');
    expect(invite.subject).not.toMatch(/today/i);
    expect(invite.text).not.toMatch(/\btoday\b/i);

    const turkish = buildInvite({
      group: group({ commonLanguages: ['tr'] }),
      venue: VENUE,
      organizer,
    });
    expect(turkish.subject).toContain('16 Eylül Çarşamba');
    expect(turkish.text).not.toMatch(/\bbugün\b/i);
  });

  it('puts the real slot in the subject rather than a hardcoded noon', () => {
    const late = buildInvite({ group: group({ slot: '13:30' }), venue: VENUE, organizer });
    expect(late.subject).toContain('13:30');
    expect(late.subject).not.toContain('12:00');
  });

  it('says which day a cancelled lunch was, in both languages', () => {
    const cancelled = buildInvite({ group: group(), venue: VENUE, organizer, method: 'CANCEL' });
    expect(cancelled.subject).toContain('Wednesday 16 September');
    expect(cancelled.text).not.toMatch(/\btoday\b/i);
    expect(cancelled.text).toContain('Wednesday 16 September');

    const turkish = buildInvite({
      group: group({ commonLanguages: ['tr'] }),
      venue: VENUE,
      organizer,
      method: 'CANCEL',
    });
    expect(turkish.subject).toContain('16 Eylül Çarşamba');
    expect(turkish.text).not.toMatch(/\bbugün\b/i);
  });

  it('carries the same text into the calendar attachment', () => {
    expect(invite.ics).toContain('DESCRIPTION:');
    expect(invite.ics).toContain('METHOD:REQUEST');
  });

  it('bumps the calendar sequence when the table has changed', () => {
    // A reseated table must update the event people already accepted, not add a
    // second one to their calendar.
    expect(invite.ics).toContain('SEQUENCE:0');
    const updated = buildInvite({ group: group(), venue: VENUE, organizer, sequence: 2 });
    expect(updated.ics).toContain('SEQUENCE:2');
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

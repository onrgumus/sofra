import { describe, expect, it } from 'vitest';
import { buildReminder } from '../src/notify/reminder';
import { employee } from './helpers';

const VENUE = {
  officeId: 'IST-HQ',
  displayName: 'Istanbul HQ',
  timeZone: 'Europe/Istanbul',
  meetingPoint: 'Ground floor cafeteria',
};

const build = (languages: string[], name = 'Zeynep Kaya') =>
  buildReminder({
    employee: employee('z', { displayName: name, languages }),
    venue: VENUE,
    date: '2026-10-06',
    dayLabel: 'Tue 6 Oct',
    optInUrl: 'https://sofra.acme.test/?day=2026-10-06',
    settingsUrl: 'https://sofra.acme.test/you',
    closesAt: '06:00',
    because: 'recent',
  });

describe('the evening question as a mail', () => {
  it('has one thing to do, as a button, and its own way out as a link', () => {
    const { html, text } = build(['en']);
    expect(html).toContain('href="https://sofra.acme.test/?day=2026-10-06"');
    expect(html.match(/Count me in/g)).toHaveLength(1);
    expect(html).toContain('href="https://sofra.acme.test/you"');
    expect(html).not.toContain('Count me in: https');
    expect(text).toContain('Count me in: https://sofra.acme.test/?day=2026-10-06');
  });

  it('escapes the name somebody gave themselves', () => {
    expect(build(['en'], 'Zey<b>nep').html).toContain('Hi Zey&lt;b&gt;nep,');
  });

  it('says the time in Turkish without a suffix that only fits some hours', () => {
    expect(build(['tr']).text).toContain('saat 06:00 itibarıyla');
  });
});

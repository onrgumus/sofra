import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestDb, officeFixture, person, seedBasics, type TestDb } from './support/db';
import { RecordingChannel } from './support/channel';
import {
  daysOfEvent,
  ensureFreshHints,
  officeFromEvent,
  refreshHints,
} from '../src/services/calendar';
import { syncDirectory } from '../src/services/directory-sync';
import { calendarHints, hintedFor, listMail } from '../src/data/messages';
import { findPerson, getPerson } from '../src/data/people';
import { findLiveSession, insertSession } from '../src/data/sessions';
import { listDepartments } from '../src/data/settings';
import type { Employee } from '../src/core/types';
import type { Directory } from '../src/directory/types';
import { OutboxTransport, mailTransportKind } from '../src/services/mail';
import { GraphMailTransport, sendInvite } from '../src/notify/transport';
import { getDb } from '../src/db';

let t: TestDb;
const IST = officeFixture();
const AMS = officeFixture({ id: 'AMS', name: 'Amsterdam', locationKeywords: ['zuidas'] });

beforeAll(async () => {
  t = await createTestDb();
  await seedBasics(t.db);
});
afterAll(async () => t.cleanup());

describe('reading office days from Outlook', () => {
  it('recognises the work-location feature and desk bookings by name', () => {
    expect(
      officeFromEvent(
        { workingLocationType: 'office', location: { displayName: 'Maslak 5. kat' } },
        [IST, AMS],
      ),
    ).toBe('IST');
    expect(officeFromEvent({ subject: 'Desk booked: Zuidas A-12' }, [IST, AMS])).toBe('AMS');
    expect(officeFromEvent({ workingLocation: { type: 'office' } }, [IST, AMS])).toBe('');
  });

  it('does not take working from home, or an ordinary meeting, for an office day', () => {
    expect(
      officeFromEvent({ workingLocationType: 'home', subject: 'Istanbul sync' }, [IST]),
    ).toBeNull();
    expect(officeFromEvent({ subject: 'Quarterly review' }, [IST])).toBeNull();
  });

  it('spreads an all-day entry over its days, end exclusive', () => {
    expect(
      daysOfEvent({
        isAllDay: true,
        start: { dateTime: '2026-10-05T00:00:00.0000000' },
        end: { dateTime: '2026-10-07T00:00:00.0000000' },
      }),
    ).toEqual(['2026-10-05', '2026-10-06']);
    expect(
      daysOfEvent({
        start: { dateTime: '2026-10-05T09:00:00' },
        end: { dateTime: '2026-10-05T17:00:00' },
      }),
    ).toEqual(['2026-10-05']);
  });

  it('stores what the calendar says, and only reads it again after an hour', async () => {
    vi.stubEnv('SOFRA_CALENDAR_HINTS', 'outlook');
    const p = await person(t.db, 1);
    const paths: string[] = [];
    const graphGet = async (path: string) => {
      paths.push(path);
      return {
        value: [
          {
            subject: 'Office: Maslak',
            start: { dateTime: '2026-10-05T08:00:00' },
            end: { dateTime: '2026-10-05T18:00:00' },
          },
          {
            workingLocationType: 'home',
            start: { dateTime: '2026-10-06T08:00:00' },
            end: { dateTime: '2026-10-06T18:00:00' },
          },
        ],
      };
    };

    await refreshHints(t.db, graphGet, p, [IST, AMS], { from: '2026-10-05', to: '2026-10-09' });
    expect(paths[0]).toContain(
      '/calendarView?startDateTime=2026-10-05T00:00:00Z&endDateTime=2026-10-10T00:00:00Z',
    );
    expect([...(await calendarHints(t.db, p.id, ['2026-10-05', '2026-10-06']))]).toEqual([
      ['2026-10-05', 'IST'],
    ]);
    expect(await hintedFor(t.db, 'IST', '2026-10-05')).toContain(p.id);

    await ensureFreshHints(t.db, graphGet, p, [IST], { from: '2026-10-05', to: '2026-10-09' });
    expect(paths).toHaveLength(1);
    vi.unstubAllEnvs();
  });

  it('shrugs off a mailbox it cannot read', async () => {
    vi.stubEnv('SOFRA_CALENDAR_HINTS', 'outlook');
    const p = await person(t.db, 2);
    await expect(
      ensureFreshHints(
        t.db,
        async () => {
          throw new Error('403');
        },
        p,
        [IST],
        { from: '2026-10-05', to: '2026-10-05' },
      ),
    ).resolves.toBeUndefined();
    vi.unstubAllEnvs();
  });
});

function employee(id: string, overrides: Partial<Employee> = {}): Employee {
  return {
    id,
    displayName: `Dir ${id}`,
    email: `${id}@acme.test`,
    title: 'Engineer',
    seniority: 'senior',
    department: 'Engineering',
    team: 'Engineering/Platform',
    officeId: 'IST',
    languages: ['en'],
    tenureMonths: 12,
    interests: [],
    ...overrides,
  };
}

function directoryOf(list: Employee[]): Directory {
  return { name: 'fake', listEmployees: async () => list };
}

describe('syncing people from a directory', () => {
  it('brings new people in, not yet set up, with what the directory knows filled in', async () => {
    const summary = await syncDirectory(
      t.db,
      directoryOf([
        employee('d1', {
          externalIds: { entra: 'oid-d1' },
          department: 'Treasury',
          team: 'Treasury/Platform',
        }),
        employee('d2', { officeId: '' }),
      ]),
      'entra',
    );
    expect(summary).toMatchObject({ read: 2, created: 2, updated: 0, deactivated: 0 });

    const d1 = await findPerson(t.db, { entraObjectId: 'oid-d1' });
    expect(d1).toMatchObject({
      department: 'Treasury',
      team: 'Platform',
      officeId: 'IST',
      onboardedAt: null,
      source: 'entra',
    });
    expect(await listDepartments(t.db)).toContain('Treasury');
    expect((await findPerson(t.db, { addresses: ['d2@acme.test'] }))?.officeId).toBeNull();
  });

  it('updates what the directory owns and leaves what people chose', async () => {
    const d1 = (await findPerson(t.db, { entraObjectId: 'oid-d1' }))!;
    await t.db.query(
      "UPDATE employees SET office_id = 'IST', languages = ARRAY['tr'] WHERE id = $1",
      [d1.id],
    );

    await syncDirectory(
      t.db,
      directoryOf([
        employee('d1', {
          externalIds: { entra: 'oid-d1' },
          title: 'Lead Engineer',
          department: 'Treasury',
          languages: ['en'],
        }),
        employee('d2', { officeId: '' }),
      ]),
      'entra',
    );
    const after = (await getPerson(t.db, d1.id))!;
    expect(after.title).toBe('Lead Engineer');
    expect(after.languages).toEqual(['tr']);
  });

  it('deactivates and signs out whoever has left', async () => {
    const d2 = (await findPerson(t.db, { addresses: ['d2@acme.test'] }))!;
    await insertSession(t.db, {
      idHash: 'h-d2',
      employeeId: d2.id,
      method: 'email',
      expiresAt: new Date(Date.now() + 86_400_000),
      userAgent: '',
      ip: '',
    });
    const summary = await syncDirectory(
      t.db,
      directoryOf([employee('d1', { externalIds: { entra: 'oid-d1' }, department: 'Treasury' })]),
      'entra',
    );
    expect(summary.deactivated).toBe(1);
    expect((await getPerson(t.db, d2.id))?.active).toBe(false);
    expect(await findLiveSession(t.db, 'h-d2')).toBeNull();
  });

  it('holds back when the read suddenly has half the company missing', async () => {
    const many = Array.from({ length: 20 }, (_, i) => employee(`m${i}`));
    await syncDirectory(t.db, directoryOf(many), 'csv');
    const summary = await syncDirectory(t.db, directoryOf(many.slice(0, 3)), 'csv');
    expect(summary.deactivated).toBe(0);
    expect(summary.heldBack).toMatch(/17 of 20/);
  });
});

describe('mail', () => {
  it('keeps mail in the outbox when told to', async () => {
    const transport = new OutboxTransport(getDb);
    await transport.send({
      from: 'a@acme.test',
      to: ['B@acme.test'],
      subject: 'Hi',
      text: 'x',
      html: '<p>x</p>',
    });
    const [mail] = await listMail(t.db, { recipient: 'b@acme.test' });
    expect(mail).toMatchObject({ subject: 'Hi', recipients: ['b@acme.test'] });
  });

  it('refuses to guess a transport in production', () => {
    vi.stubEnv('NODE_ENV', 'production');
    expect(() => mailTransportKind()).toThrow(/SOFRA_MAIL_TRANSPORT/);
    vi.stubEnv('SOFRA_MAIL_TRANSPORT', 'smtp');
    expect(mailTransportKind()).toBe('smtp');
    vi.unstubAllEnvs();
  });

  it('sends through Microsoft 365 with the calendar as an attachment', async () => {
    const calls: { path: string; body: unknown }[] = [];
    const transport = new GraphMailTransport({
      graph: async (_m, path, body) => {
        calls.push({ path, body });
        return {};
      },
      sender: 'sofra@acme.test',
    });
    await sendInvite(
      transport,
      {
        subject: 'Lunch',
        text: 't',
        html: 'h',
        ics: 'BEGIN:VCALENDAR\r\nMETHOD:CANCEL\r\n',
        to: [{ name: 'A', email: 'a@acme.test' }],
        topic: '',
        confirmUrl: null,
      },
      { from: 'sofra@acme.test' },
    );
    expect(calls[0]!.path).toBe('/users/sofra%40acme.test/sendMail');
    const message = (calls[0]!.body as { message: { attachments: { contentType: string }[] } })
      .message;
    // A cancellation says so in its content type, or clients add the lunch back.
    expect(message.attachments[0]!.contentType).toBe('text/calendar; method=CANCEL');
  });
});

describe('a channel that fails for one person', () => {
  beforeEach(() => vi.unstubAllEnvs());
  it('is recorded per table, not thrown', () => {
    const channel = new RecordingChannel();
    channel.failFor.add('x@acme.test');
    return expect(
      channel.sendReminder({
        employee: employee('x'),
        subject: '',
        text: '',
        html: '',
        actionUrl: '',
        actionLabel: '',
      }),
    ).rejects.toThrow(/unavailable/);
  });
});

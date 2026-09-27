import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SmtpTransport, sendInvite } from '../src/notify/transport';
import { startFakeSmtp, type FakeSmtp } from './support/fake-smtp';

/**
 * The SMTP transport against a real SMTP conversation: a server on this
 * machine that speaks STARTTLS and AUTH, with a certificate of its own.
 */
let server: FakeSmtp;
let plain: FakeSmtp;

beforeAll(async () => {
  server = await startFakeSmtp();
  plain = await startFakeSmtp({ offerTls: false });
});
afterAll(async () => {
  await server.close();
  await plain.close();
});

describe('sending through the company mail server', () => {
  it('upgrades to TLS, trusts the relay only through the CA it was given, and delivers', async () => {
    const transport = new SmtpTransport({
      host: 'localhost',
      port: server.port,
      secure: false,
      user: 'sofra',
      password: 'secret',
      ca: server.cert,
    });

    await sendInvite(
      transport,
      {
        subject: 'Lunch Monday at 12:00, the three of you',
        text: 'The 3 of you are having lunch together.',
        html: '<p>The 3 of you are having lunch together.</p>',
        ics: 'BEGIN:VCALENDAR\r\nMETHOD:REQUEST\r\nBEGIN:VEVENT\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n',
        to: [
          { name: 'Ada', email: 'ada@acme.test' },
          { name: 'Bo', email: 'bo@acme.test' },
        ],
        topic: '',
        confirmUrl: null,
      },
      { from: 'Sofra <sofra@acme.test>' },
    );

    expect(server.received).toHaveLength(1);
    const [mail] = server.received;
    expect(mail).toMatchObject({
      from: 'sofra@acme.test',
      to: ['ada@acme.test', 'bo@acme.test'],
      secure: true,
      user: 'sofra',
    });
    expect(mail!.data).toContain('Subject: Lunch Monday at 12:00, the three of you');
    expect(mail!.data).toContain('text/calendar; method=REQUEST');
  });

  it('refuses a relay whose certificate it has no reason to trust', async () => {
    const transport = new SmtpTransport({ host: 'localhost', port: server.port, secure: false });
    await expect(
      transport.send({
        from: 'sofra@acme.test',
        to: ['ada@acme.test'],
        subject: 's',
        text: 't',
        html: 'h',
      }),
    ).rejects.toThrow(/certificate/i);
  });

  it('never sends a sign-in link in the clear to a relay that does not encrypt', async () => {
    const before = plain.received.length;
    const transport = new SmtpTransport({ host: 'localhost', port: plain.port, secure: false });
    await expect(
      transport.send({
        from: 'sofra@acme.test',
        to: ['ada@acme.test'],
        subject: 's',
        text: 't',
        html: 'h',
      }),
    ).rejects.toThrow();
    expect(plain.received.length).toBe(before);
  });
});

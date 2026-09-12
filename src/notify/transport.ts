import type { Invite } from './invite.js';

export interface EmailMessage {
  from: string;
  to: string[];
  subject: string;
  text: string;
  html: string;
  attachments?: { filename: string; content: string; contentType: string }[];
}

export interface EmailTransport {
  readonly name: string;
  send(message: EmailMessage): Promise<void>;
}

export interface SendInviteOptions {
  from: string;
  /** Send one mail to all four (they see each other) or four separate mails. */
  mode?: 'single-thread' | 'individual';
}

export async function sendInvite(
  transport: EmailTransport,
  invite: Invite,
  options: SendInviteOptions,
): Promise<void> {
  const attachments = [
    { filename: 'lunch.ics', content: invite.ics, contentType: 'text/calendar; method=REQUEST' },
  ];
  const base = {
    from: options.from,
    subject: invite.subject,
    text: invite.text,
    html: invite.html,
    attachments,
  };

  if ((options.mode ?? 'single-thread') === 'single-thread') {
    await transport.send({ ...base, to: invite.to.map((a) => a.email) });
    return;
  }
  for (const attendee of invite.to) {
    await transport.send({ ...base, to: [attendee.email] });
  }
}

/** Prints instead of sending. The default in development and in the simulator. */
export class ConsoleTransport implements EmailTransport {
  readonly name = 'console';

  async send(message: EmailMessage): Promise<void> {
    console.log(`\n--- mail to ${message.to.join(', ')} ---`);
    console.log(message.subject);
    console.log(message.text);
  }
}

export interface ResendTransportOptions {
  apiKey: string;
  fetchImpl?: typeof fetch;
}

/**
 * Resend adapter. Any provider works — this one is here because it is the
 * shortest path from zero to a delivered invite.
 *
 * Note: the .ics rides as an attachment, so most clients show "add to calendar"
 * rather than inline accept/decline buttons. If you need true RSVP tracking, send
 * through a mailbox that speaks iMIP (an Exchange service account will do).
 */
export class ResendTransport implements EmailTransport {
  readonly name = 'resend';

  constructor(private readonly options: ResendTransportOptions) {}

  async send(message: EmailMessage): Promise<void> {
    const doFetch = this.options.fetchImpl ?? fetch;
    const response = await doFetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.options.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: message.from,
        to: message.to,
        subject: message.subject,
        text: message.text,
        html: message.html,
        attachments: message.attachments?.map((a) => ({
          filename: a.filename,
          content: Buffer.from(a.content, 'utf8').toString('base64'),
          content_type: a.contentType,
        })),
      }),
    });

    if (!response.ok) {
      throw new Error(`Resend rejected the message: ${response.status} ${await response.text()}`);
    }
  }
}

import type { Invite } from './invite';

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
  // The content type has to name the same method as the calendar inside it, or
  // a client handed a CANCEL labelled as a REQUEST adds the lunch it was meant
  // to remove.
  const method = /^METHOD:CANCEL/m.test(invite.ics) ? 'CANCEL' : 'REQUEST';
  const attachments = [
    { filename: 'lunch.ics', content: invite.ics, contentType: `text/calendar; method=${method}` },
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
 * Resend adapter. Any provider works. This one is here because it is the
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

export interface SmtpTransportOptions {
  host: string;
  port: number;
  /** TLS from the first byte (465). Otherwise STARTTLS is required, not optional. */
  secure: boolean;
  user?: string;
  password?: string;
  /**
   * The certificate authority the server's certificate is issued by, as PEM,
   * for a relay with a company-internal certificate. Verification stays on:
   * this adds a CA to trust, it never turns checking off.
   */
  ca?: string;
}

/**
 * The company's own mail server, which is what an in-house deployment usually
 * has and what keeps invites inside the company's own mail flow.
 */
export class SmtpTransport implements EmailTransport {
  readonly name = 'smtp';
  private transporter: Promise<import('nodemailer').Transporter> | null = null;

  constructor(private readonly options: SmtpTransportOptions) {}

  private connect(): Promise<import('nodemailer').Transporter> {
    this.transporter ??= import('nodemailer').then((nodemailer) =>
      nodemailer.createTransport({
        host: this.options.host,
        port: this.options.port,
        secure: this.options.secure,
        // Never fall back to sending a sign-in link in the clear.
        requireTLS: !this.options.secure,
        ...(this.options.user
          ? { auth: { user: this.options.user, pass: this.options.password ?? '' } }
          : {}),
        ...(this.options.ca ? { tls: { ca: this.options.ca } } : {}),
      }),
    );
    return this.transporter;
  }

  async send(message: EmailMessage): Promise<void> {
    const transporter = await this.connect();
    await transporter.sendMail({
      from: message.from,
      to: message.to,
      subject: message.subject,
      text: message.text,
      html: message.html,
      attachments: message.attachments?.map((a) => ({
        filename: a.filename,
        content: a.content,
        contentType: a.contentType,
      })),
    });
  }
}

export interface GraphMailTransportOptions {
  /** Authenticated Graph request, app-only, with Mail.Send. */
  graph: (method: 'GET' | 'POST', path: string, body?: unknown) => Promise<Record<string, unknown>>;
  /** The mailbox that sends, e.g. a shared sofra@ mailbox. */
  sender: string;
}

/**
 * Microsoft 365, for a company whose mail is Exchange Online and which would
 * rather grant Mail.Send (ideally scoped to one mailbox) than run SMTP relay.
 */
export class GraphMailTransport implements EmailTransport {
  readonly name = 'graph';

  constructor(private readonly options: GraphMailTransportOptions) {}

  async send(message: EmailMessage): Promise<void> {
    await this.options.graph('POST', `/users/${encodeURIComponent(this.options.sender)}/sendMail`, {
      message: {
        subject: message.subject,
        body: { contentType: 'HTML', content: message.html },
        toRecipients: message.to.map((address) => ({ emailAddress: { address } })),
        attachments: (message.attachments ?? []).map((a) => ({
          '@odata.type': '#microsoft.graph.fileAttachment',
          name: a.filename,
          contentType: a.contentType,
          contentBytes: Buffer.from(a.content, 'utf8').toString('base64'),
        })),
      },
      saveToSentItems: false,
    });
  }
}

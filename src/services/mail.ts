import { readFileSync } from 'node:fs';
import type { Db } from '../db';
import { getDb } from '../db';
import { storeMail } from '../data/messages';
import { envOptional, envText } from '../lib/env';
import { createGraphClient } from '../lib/graph';
import {
  CompositeChannel,
  EmailChannel,
  SlackChannel,
  TeamsActivityChannel,
  TeamsChannel,
  type InviteChannel,
} from '../notify/channels';
import {
  ConsoleTransport,
  GraphMailTransport,
  ResendTransport,
  SmtpTransport,
  type EmailMessage,
  type EmailTransport,
} from '../notify/transport';
import { TeamsBotChannel } from '../teams/channel';
import { botConfig } from '../teams/config';

export const FROM_EMAIL = envText('SOFRA_FROM_EMAIL', 'Sofra <sofra@example.com>');

/**
 * Keeps mail in the database instead of sending it, and shows it at
 * /dev/mailbox. For development, and for a deployment that has not been given
 * a mail server yet, so a sign-in link can still be followed.
 */
export class OutboxTransport implements EmailTransport {
  readonly name = 'outbox';

  constructor(private readonly db: () => Db) {}

  async send(message: EmailMessage): Promise<void> {
    await storeMail(this.db(), {
      sender: message.from,
      recipients: message.to.map((a) => a.toLowerCase()),
      subject: message.subject,
      text: message.text,
      html: message.html,
      attachments: message.attachments ?? [],
    });
  }
}

export type MailTransportKind = 'outbox' | 'console' | 'smtp' | 'graph' | 'resend';

/** Which transport this deployment uses. Outbox unless told otherwise, and never by default in production. */
export function mailTransportKind(): MailTransportKind {
  const configured = envOptional('SOFRA_MAIL_TRANSPORT') as MailTransportKind | undefined;
  if (configured) return configured;
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'SOFRA_MAIL_TRANSPORT is not set. Choose smtp, graph or resend; outbox keeps mail in the database unsent.',
    );
  }
  return 'outbox';
}

export function mailboxEnabled(): boolean {
  try {
    return mailTransportKind() === 'outbox';
  } catch {
    return false;
  }
}

export function configuredTransport(): EmailTransport {
  const kind = mailTransportKind();
  switch (kind) {
    case 'outbox':
      return new OutboxTransport(getDb);
    case 'console':
      return new ConsoleTransport();
    case 'smtp': {
      const host = envOptional('SMTP_HOST');
      if (!host) throw new Error('SOFRA_MAIL_TRANSPORT=smtp needs SMTP_HOST');
      const port = Number(envText('SMTP_PORT', '587'));
      return new SmtpTransport({
        host,
        port,
        secure: envText('SMTP_SECURE', port === 465 ? 'true' : 'false') === 'true',
        user: envOptional('SMTP_USER'),
        password: envOptional('SMTP_PASSWORD'),
        ...(envOptional('SMTP_CA_FILE')
          ? { ca: readFileSync(envOptional('SMTP_CA_FILE')!, 'utf8') }
          : {}),
      });
    }
    case 'graph': {
      const graph = graphClient();
      const sender = envOptional('SOFRA_MAIL_SENDER');
      if (!graph || !sender) {
        throw new Error(
          'SOFRA_MAIL_TRANSPORT=graph needs MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET and SOFRA_MAIL_SENDER',
        );
      }
      return new GraphMailTransport({ graph, sender });
    }
    case 'resend': {
      const apiKey = envOptional('RESEND_API_KEY');
      if (!apiKey) throw new Error('SOFRA_MAIL_TRANSPORT=resend needs RESEND_API_KEY');
      return new ResendTransport({ apiKey });
    }
    default:
      throw new Error(`Unknown SOFRA_MAIL_TRANSPORT: ${String(kind)}`);
  }
}

export function graphClient() {
  const tenantId = envOptional('MS_TENANT_ID');
  const clientId = envOptional('MS_CLIENT_ID');
  const clientSecret = envOptional('MS_CLIENT_SECRET');
  if (!tenantId || !clientId || !clientSecret) return null;
  return createGraphClient({ tenantId, clientId, clientSecret });
}

/**
 * Every channel this deployment has what it needs for.
 *
 * Email always: it is the one that needs nobody's permission. Teams and Slack
 * join when their credentials exist, and one being down never stops another.
 */
export function configuredChannel(): InviteChannel {
  const channels: InviteChannel[] = [
    new EmailChannel({ transport: configuredTransport(), from: FROM_EMAIL }),
  ];

  const slackToken = envOptional('SLACK_BOT_TOKEN');
  if (slackToken)
    channels.push(new SlackChannel({ token: slackToken, onUnreachable: warn('slack') }));

  const graph = graphClient();
  const teamsAppId = envOptional('TEAMS_APP_ID');
  if (graph && teamsAppId) {
    channels.push(
      new TeamsActivityChannel({ graph, teamsAppId, onUnreachable: warn('teams-activity') }),
    );
  }
  if (graph && envOptional('MS_CAN_SEND_CHAT_MESSAGES') === 'true') {
    channels.push(new TeamsChannel({ graph, canSendMessages: true, onUnreachable: warn('teams') }));
  }

  const bot = botConfig();
  if (bot)
    channels.push(
      new TeamsBotChannel({ config: bot, db: getDb, onUnreachable: warn('teams-bot') }),
    );

  if (channels.length === 1) return channels[0]!;
  return new CompositeChannel(channels, (name, error) =>
    console.error(`[sofra] ${name} delivery failed:`, error),
  );
}

function warn(channel: string) {
  return (employee: { displayName: string }, reason: string) =>
    console.warn(`[sofra] ${channel}: ${employee.displayName} unreachable: ${reason}`);
}

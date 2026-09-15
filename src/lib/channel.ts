import {
  CompositeChannel,
  EmailChannel,
  SlackChannel,
  TeamsActivityChannel,
  TeamsChannel,
  type InviteChannel,
} from '../notify/channels';
import { ConsoleTransport, ResendTransport, type EmailTransport } from '../notify/transport';
import { createGraphClient } from './graph';

export const FROM_EMAIL = process.env.SOFRA_FROM_EMAIL ?? 'Sofra <sofra@example.com>';

/**
 * Assembles the channels this deployment actually has credentials for.
 *
 * Email is always there, because it is the one that needs nobody's permission.
 * Slack and Teams switch on when their tokens exist, so a company can adopt
 * either without a code change, and without one being down stopping the other.
 */
export function configuredChannel(): InviteChannel {
  const channels: InviteChannel[] = [
    new EmailChannel({ transport: emailTransport(), from: FROM_EMAIL }),
  ];

  const slackToken = process.env.SLACK_BOT_TOKEN;
  if (slackToken) {
    channels.push(new SlackChannel({ token: slackToken, onUnreachable: warn('slack') }));
  }

  const { MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET, MS_CAN_SEND_CHAT_MESSAGES, TEAMS_APP_ID } =
    process.env;

  if (MS_TENANT_ID && MS_CLIENT_ID && MS_CLIENT_SECRET) {
    const graph = createGraphClient({
      tenantId: MS_TENANT_ID,
      clientId: MS_CLIENT_ID,
      clientSecret: MS_CLIENT_SECRET,
    });

    // The activity feed is the Teams route that works on a schedule:
    // sendActivityNotification has an application permission, and a chat
    // message does not. Needs the Teams app id to deep-link into the tab.
    if (TEAMS_APP_ID) {
      channels.push(
        new TeamsActivityChannel({
          graph,
          teamsAppId: TEAMS_APP_ID,
          onUnreachable: warn('teams-activity'),
        }),
      );
    }

    // The group chat stays opt-in behind a flag naming what actually gates it,
    // because client credentials alone only buy you a 403.
    if (MS_CAN_SEND_CHAT_MESSAGES === 'true') {
      channels.push(
        new TeamsChannel({ graph, canSendMessages: true, onUnreachable: warn('teams') }),
      );
    }
  }

  if (channels.length === 1) return channels[0]!;
  return new CompositeChannel(channels, (name, error) =>
    console.error(`[sofra] ${name} delivery failed:`, error),
  );
}

function emailTransport(): EmailTransport {
  const apiKey = process.env.RESEND_API_KEY;
  // Without a key, invites are printed rather than sent. That is the right
  // default for a demo and an obvious one to notice in production.
  return apiKey ? new ResendTransport({ apiKey }) : new ConsoleTransport();
}

function warn(channel: string) {
  return (employee: { displayName: string }, reason: string) =>
    console.warn(`[sofra] ${channel}: ${employee.displayName} unreachable: ${reason}`);
}

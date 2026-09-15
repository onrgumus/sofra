import type { Employee } from '../../core/types';
import type { AccountResolver, Delivery, InviteChannel } from './types';
import { resolveByEmail } from './types';

/**
 * Delivers the invite into Teams as an activity feed notification, deep-linked
 * to the Sofra tab.
 *
 * This is the Teams path that actually works on a schedule. Two things rule out
 * the obvious alternatives, and both are in Microsoft's own reference rather
 * than folklore:
 *
 *   - POST /chats/{id}/messages has no application permission for sending
 *     (only Teamwork.Migrate.All, which is for importing history), so a cron
 *     holding client credentials cannot post a chat message.
 *   - A bot cannot help either: "You can't create a new group chat or a new
 *     channel in a team with proactive messaging."
 *
 * POST /users/{id}/teamwork/sendActivityNotification does have an application
 * permission, TeamsActivity.Send. The notification lands in each person's
 * activity feed and opens the tab, where the table, the names and the RSVP
 * buttons already live. Four notifications rather than one shared chat, which
 * is a real loss next to Slack, and the honest best Teams allows.
 */
export interface TeamsActivityChannelOptions {
  /** Authenticated Graph request. Injected so this stays SDK-free and testable. */
  graph: (method: 'GET' | 'POST', path: string, body?: unknown) => Promise<Record<string, unknown>>;
  /** Teams app id, used to deep-link into the tab. */
  teamsAppId: string;
  /** Entity id of the tab to open. Must match `staticTabs` in the manifest. */
  entityId?: string;
  resolveAccount?: AccountResolver;
  onUnreachable?: (employee: Employee, reason: string) => void;
}

/** Declared in teams/manifest.json under `activities.activityTypes`. */
const INVITE_ACTIVITY = 'lunchMatched';
const CANCEL_ACTIVITY = 'lunchCancelled';

export class TeamsActivityChannel implements InviteChannel {
  readonly name = 'teams-activity';

  constructor(private readonly options: TeamsActivityChannelOptions) {}

  async sendInvite(delivery: Delivery): Promise<void> {
    await this.notify(delivery, INVITE_ACTIVITY, [
      { name: 'tableSize', value: String(delivery.members.length) },
      { name: 'time', value: delivery.invite.subject },
    ]);
  }

  async sendCancellation(delivery: Delivery): Promise<void> {
    await this.notify(delivery, CANCEL_ACTIVITY, [
      { name: 'time', value: delivery.invite.subject },
    ]);
  }

  private async notify(
    delivery: Delivery,
    activityType: string,
    templateParameters: { name: string; value: string }[],
  ): Promise<void> {
    const resolve = this.options.resolveAccount ?? resolveByEmail;

    for (const member of delivery.members) {
      const account = await resolve(member);
      if (!account) {
        this.options.onUnreachable?.(member, 'no Teams account for this person');
        continue;
      }

      try {
        await this.options.graph(
          'POST',
          `/users/${encodeURIComponent(account)}/teamwork/sendActivityNotification`,
          {
            topic: {
              // `text` needs an explicit webUrl; `entityUrl` would need each
              // person's installation id, which is a second round trip per
              // person for the same destination.
              source: 'text',
              value: 'Sofra',
              webUrl: this.deepLink(),
            },
            activityType,
            previewText: { content: previewFor(delivery) },
            templateParameters,
          },
        );
      } catch (error) {
        // One person with the app uninstalled must not cost the other three
        // their notification.
        this.options.onUnreachable?.(member, String(error));
      }
    }
  }

  private deepLink(): string {
    const entityId = this.options.entityId ?? 'sofra.lunches';
    return `https://teams.microsoft.com/l/entity/${this.options.teamsAppId}/${entityId}`;
  }
}

/** Teams shows the first 150 characters, so lead with the names. */
function previewFor(delivery: Delivery): string {
  const names = delivery.members.map((m) => m.displayName).join(', ');
  return `${delivery.invite.subject}: ${names}`.slice(0, 150);
}

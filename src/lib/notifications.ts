import { buildInvite } from '../notify/invite';
import type { InviteChannel } from '../notify/channels';
import type { Store, StoredGroup } from '../store/types';
import { toVenue } from './venue';
import { BASE_URL, confirmUrl } from './config';
import { formatDay } from './dates';
import { buildUnseated } from '../notify/unseated';

export interface DeliveryOptions {
  store: Store;
  /** Email, Slack, Teams, or several at once. See `src/notify/channels`. */
  channel: InviteChannel;
  /** Organiser address on the calendar invite. */
  from: string;
  date: string;
  officeId: string;
}

export interface DeliveryResult {
  invitesSent: number;
  cancellationsSent: number;
  /** People told that there was no table for them. */
  unseatedTold: number;
  /** Tables whose send failed. Reported, never fatal. */
  failed: { groupId: string; reason: string }[];
}

/** The `kind` under which "we could not seat you" is recorded, so it goes once. */
export const UNSEATED_KIND = 'unseated';

/**
 * Brings everyone's inbox and calendar up to date with what the tables actually
 * say right now.
 *
 * Two things need sending, and both are easy to forget. A table that gained
 * someone after its invite went out needs the invite again, with a bumped
 * SEQUENCE so calendars update the event rather than adding a second one. And a
 * cancelled table whose invite already went out needs a CANCEL, or it sits in
 * four calendars as a lunch that is not happening.
 *
 * The console button, the nightly job and the RSVP flow all call this, so there
 * is one definition of "what still needs sending".
 */
export async function deliverPending(options: DeliveryOptions): Promise<DeliveryResult> {
  const { store, channel, from, date, officeId } = options;
  const result: DeliveryResult = {
    invitesSent: 0,
    cancellationsSent: 0,
    unseatedTold: 0,
    failed: [],
  };

  const office = await store.getOffice(officeId);
  if (!office) return result;

  const venue = toVenue(office);
  const organizer = { name: 'Sofra', email: from };

  for (const group of await store.listGroups(date, officeId)) {
    if (group.members.length === 0) continue;

    // One table must not take down the rest. A single undeliverable address is
    // ordinary in a real directory: somebody has left, a contractor has no
    // mailbox, a provider refuses a domain. Letting that throw meant the nightly
    // job died on the first bad recipient and nobody at all got an invite.
    try {
      if (group.cancelled) {
        // Only worth cancelling if they were told about it in the first place.
        if (group.invitesSentAt === null || group.cancellationSentAt !== null) continue;

        await channel.sendCancellation({
          groupId: group.id,
          members: group.members,
          invite: buildInvite({
            group,
            venue,
            organizer,
            sequence: group.sequence,
            method: 'CANCEL',
          }),
        });
        await store.markCancellationSent(group.id);
        result.cancellationsSent++;
        continue;
      }

      if (group.invitesSentAt !== null) continue;

      await channel.sendInvite({
        groupId: group.id,
        members: group.members,
        invite: buildInvite({
          group,
          venue,
          organizer,
          confirmUrl: confirmUrl(group.id),
          sequence: group.sequence,
        }),
      });
      await store.markInviteSent(group.id);
      result.invitesSent++;
    } catch (error) {
      // Left unmarked, so the next run tries again rather than treating a
      // failure as delivery.
      result.failed.push({ groupId: group.id, reason: describe(error) });
    }
  }

  await tellUnseated(options, result);
  return result;
}

/**
 * Tells the people who asked and got nothing.
 *
 * Silence was the worst thing this product did. The engine has recorded why
 * somebody could not be seated since the first commit, and until now only the
 * admin console ever read it, so the person was left to conclude that three
 * colleagues had been asked and none of them wanted to come.
 *
 * Once per person per day, on the same record the reminder uses, and only once
 * the day has actually been planned: before that there is no table because
 * matching has not run, which is not the same thing at all.
 */
async function tellUnseated(options: DeliveryOptions, result: DeliveryResult): Promise<void> {
  const { store, channel, date, officeId } = options;
  if (!channel.sendReminder) return;

  const unmatched = await store.listUnmatched(date, officeId);
  if (unmatched.length === 0) return;

  const office = await store.getOffice(officeId);
  if (!office) return;

  const told = new Set(await store.listNotified(UNSEATED_KIND, date, officeId));
  const delivered: string[] = [];

  for (const { employee, reason } of unmatched) {
    if (told.has(employee.id)) continue;

    try {
      await channel.sendReminder(
        buildUnseated({
          employee,
          venue: toVenue(office),
          reason,
          dayLabel: formatDay(date),
          settingsUrl: `${BASE_URL}/you`,
        }),
      );
      delivered.push(employee.id);
      result.unseatedTold++;
    } catch (error) {
      result.failed.push({ groupId: `unseated:${employee.id}`, reason: describe(error) });
    }
  }

  await store.recordNotified(UNSEATED_KIND, date, officeId, delivered);
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

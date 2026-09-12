import { buildInvite } from '../notify/invite';
import { sendInvite, type EmailTransport } from '../notify/transport';
import type { Store } from '../store/types';
import { toVenue } from './venue';
import { confirmUrl } from './config';

export interface DeliveryOptions {
  store: Store;
  transport: EmailTransport;
  from: string;
  date: string;
  officeId: string;
}

export interface DeliveryResult {
  invitesSent: number;
  cancellationsSent: number;
}

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
  const { store, transport, from, date, officeId } = options;

  const office = store.getOffice(officeId);
  if (!office) return { invitesSent: 0, cancellationsSent: 0 };

  const venue = toVenue(office);
  const organizer = { name: 'Sofra', email: from };
  const result: DeliveryResult = { invitesSent: 0, cancellationsSent: 0 };

  for (const group of store.listGroups(date, officeId)) {
    if (group.members.length === 0) continue;

    if (group.cancelled) {
      // Only worth cancelling if they were told about it in the first place.
      if (group.invitesSentAt === null || group.cancellationSentAt !== null) continue;

      await sendInvite(
        transport,
        buildInvite({ group, venue, organizer, sequence: group.sequence, method: 'CANCEL' }),
        { from },
      );
      store.markCancellationSent(group.id);
      result.cancellationsSent++;
      continue;
    }

    if (group.invitesSentAt !== null) continue;

    await sendInvite(
      transport,
      buildInvite({
        group,
        venue,
        organizer,
        confirmUrl: confirmUrl(group.id),
        sequence: group.sequence,
      }),
      { from },
    );
    store.markInviteSent(group.id);
    result.invitesSent++;
  }

  return result;
}

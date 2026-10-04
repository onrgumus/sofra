import type { Db } from '../db';
import { listNotified, recordNotified } from '../data/messages';
import {
  listTables,
  listUnseated,
  markCancellationSent,
  markInviteSent,
  type LunchTable,
} from '../data/tables';
import type { Office } from '../data/types';
import { BASE_URL, confirmUrl } from '../lib/config';
import { formatDay } from '../lib/dates';
import type { InviteChannel } from '../notify/channels';
import { buildInvite, type OfficeVenue } from '../notify/invite';
import { buildUnseated } from '../notify/unseated';

export interface DeliveryResult {
  invitesSent: number;
  cancellationsSent: number;
  unseatedTold: number;
  failed: { tableId: string; reason: string }[];
}

/** Recorded once per person per day, so "no table for you" is said once. */
export const UNSEATED_KIND = 'unseated';

export function venueOf(office: Office, timeZone = office.timeZone): OfficeVenue {
  return {
    officeId: office.id,
    displayName: office.name,
    timeZone,
    meetingPoint: office.meetingPoint || office.address || office.name,
  };
}

export function inviteFor(
  table: LunchTable,
  office: Office,
  from: string,
  method: 'REQUEST' | 'CANCEL' = 'REQUEST',
  cancelReason?: 'too-small' | 'replanned',
) {
  return buildInvite({
    group: table,
    venue: venueOf(office, table.timeZone),
    organizer: { name: 'Sofra', email: fromAddress(from) },
    ...(method === 'REQUEST'
      ? { confirmUrl: confirmUrl(table.id), confirmBy: office.confirmBy }
      : {}),
    sequence: table.sequence,
    method,
    ...(cancelReason ? { cancelReason } : {}),
  });
}

/** 'Sofra <sofra@acme.com>' to 'sofra@acme.com', for the calendar organiser. */
function fromAddress(from: string): string {
  return from.match(/<([^>]+)>/)?.[1] ?? from;
}

/**
 * Brings inboxes and calendars up to date with what the day's tables say now.
 *
 * A table that changed after its invite went out gets the invite again, with a
 * higher SEQUENCE so calendars update the event instead of adding another. A
 * cancelled table that people were told about gets a CANCEL. Somebody who asked
 * and could not be seated is told why, once. One failure never stops the rest:
 * a single address that bounces is ordinary, and the other tables still need
 * their lunch.
 */
export async function deliverPending(
  db: Db,
  channel: InviteChannel,
  office: Office,
  date: string,
  from: string,
): Promise<DeliveryResult> {
  const result: DeliveryResult = {
    invitesSent: 0,
    cancellationsSent: 0,
    unseatedTold: 0,
    failed: [],
  };

  for (const table of await listTables(db, office.id, date)) {
    if (table.members.length === 0) continue;
    try {
      if (table.cancelled) {
        if (table.invitesSentAt === null || table.cancellationSentAt !== null) continue;
        await channel.sendCancellation({
          groupId: table.id,
          members: table.members,
          invite: inviteFor(table, office, from, 'CANCEL'),
        });
        await markCancellationSent(db, table.id);
        result.cancellationsSent++;
        continue;
      }

      if (table.invitesSentAt !== null) continue;
      const venue = venueOf(office, table.timeZone);
      await channel.sendInvite({
        groupId: table.id,
        members: table.members,
        invite: inviteFor(table, office, from),
        details: {
          date: table.date,
          dayLabel: formatDay(table.date),
          slot: table.slot,
          place: `${venue.displayName} — ${venue.meetingPoint}`,
          rsvps: table.rsvps,
          canReply: true,
        },
      });
      await markInviteSent(db, table.id, table.sequence);
      result.invitesSent++;
    } catch (error) {
      result.failed.push({ tableId: table.id, reason: describe(error) });
    }
  }

  if (channel.sendReminder) {
    const told = await listNotified(db, UNSEATED_KIND, office.id, date);
    const delivered: string[] = [];
    for (const { employee, reason } of await listUnseated(db, office.id, date)) {
      if (told.has(employee.id)) continue;
      try {
        await channel.sendReminder(
          buildUnseated({
            employee,
            venue: venueOf(office),
            reason,
            dayLabel: formatDay(date),
            settingsUrl: `${BASE_URL}/you`,
          }),
        );
        delivered.push(employee.id);
        result.unseatedTold++;
      } catch (error) {
        result.failed.push({ tableId: `unseated:${employee.id}`, reason: describe(error) });
      }
    }
    await recordNotified(db, UNSEATED_KIND, office.id, date, delivered);
  }

  return result;
}

export function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

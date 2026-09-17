import type { Employee } from '../../core/types';
import type { Invite } from '../invite';
import type { Reminder } from '../reminder';

/**
 * How a table is told about its lunch.
 *
 * This sits a level above `EmailTransport`, which can only say "send this
 * message to these addresses". Chat platforms need two steps: open a
 * conversation for exactly these four people, then post into it, and the
 * conversation is worth keeping, because "where shall we go" is a conversation.
 *
 * Everything below the interface is per-platform. Nothing above it knows a
 * platform exists.
 */
export interface Delivery {
  /** Stable per table, so a channel can find the conversation it already made. */
  groupId: string;
  members: readonly Employee[];
  invite: Invite;
}

export interface InviteChannel {
  /** Identifier used in logs and the admin console, e.g. 'email', 'slack'. */
  readonly name: string;
  sendInvite(delivery: Delivery): Promise<void>;
  sendCancellation(delivery: Delivery): Promise<void>;
  /**
   * One message to one person, before there is a table: the nudge that asks
   * whether they want lunch on a day they are already coming in.
   *
   * Optional because it is a different shape from everything else here. A
   * channel that can only address a group leaves it out and the reminder goes
   * by whatever channel can.
   */
  sendReminder?(reminder: Reminder): Promise<void>;
}

/**
 * Employee → platform account. Slack and Graph both take an email, so the
 * default costs no configuration; companies that key users differently pass
 * their own.
 */
export type AccountResolver = (employee: Employee) => Promise<string | null>;

/**
 * A recorded platform id first, then the address.
 *
 * `users.lookupByEmail` only finds people whose Slack account uses the address
 * the company's HR export happens to carry. Where the two differ, and they
 * often do, a stored Slack user id is the difference between a table hearing
 * about its lunch and one person silently never doing so.
 */
export function resolveByAccount(system: string): AccountResolver {
  return async (employee) => employee.externalIds?.[system] ?? employee.email;
}

/** Slack's own user id where we have it, the address otherwise. */
export const resolveSlackAccount = resolveByAccount('slack');

/** The Entra object id where we have it, the address otherwise. Graph accepts
 * either in the user path, so a learned object id needs no extra lookup. */
export const resolveEntraAccount = resolveByAccount('entra');

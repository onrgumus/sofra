import type { Employee } from '../../core/types';
import type { Invite } from '../invite';

/**
 * How a table is told about its lunch.
 *
 * This sits a level above `EmailTransport`, which can only say "send this
 * message to these addresses". Chat platforms need two steps — open a
 * conversation for exactly these four people, then post into it — and the
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
}

/**
 * Employee → platform account. Slack and Graph both take an email, so the
 * default costs no configuration; companies that key users differently pass
 * their own.
 */
export type AccountResolver = (employee: Employee) => Promise<string | null>;

export const resolveByEmail: AccountResolver = async (employee) => employee.email;

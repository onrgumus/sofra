import type { Store } from '../store/types';
import { envNumber } from './env';

/**
 * How many times a password may be guessed.
 *
 * A short password with no limit is not a password, it is a delay. The demo one
 * is published and rate limiting it is theatre, but a deployment that sets its
 * own gets the protection without having to think about it.
 *
 * Counted per username rather than per IP: an attacker rotates addresses more
 * easily than the account they are after, and locking by address would let one
 * of them lock out an office behind a shared egress.
 */
export const MAX_ATTEMPTS = envNumber('SOFRA_SIGNIN_MAX_ATTEMPTS', 10);
export const WINDOW_MINUTES = envNumber('SOFRA_SIGNIN_WINDOW_MINUTES', 15);

export interface ThrottleVerdict {
  allowed: boolean;
  /** Whole minutes until the window clears, for the message shown. */
  retryInMinutes: number;
}

export async function checkSignInAllowed(
  store: Store,
  username: string,
  now: Date = new Date(),
): Promise<ThrottleVerdict> {
  const failures = await store.countSignInFailures(key(username), since(now));
  return {
    allowed: failures < MAX_ATTEMPTS,
    retryInMinutes: WINDOW_MINUTES,
  };
}

export async function recordSignInFailure(
  store: Store,
  username: string,
  now: Date = new Date(),
): Promise<void> {
  await store.recordSignInFailure(key(username), now.toISOString());
}

/** A password that worked clears the count, so an honest typo costs nothing. */
export async function clearSignInFailures(store: Store, username: string): Promise<void> {
  await store.clearSignInFailures(key(username));
}

function key(username: string): string {
  return `signin:${username.trim().toLowerCase()}`;
}

function since(now: Date): string {
  return new Date(now.getTime() - WINDOW_MINUTES * 60_000).toISOString();
}

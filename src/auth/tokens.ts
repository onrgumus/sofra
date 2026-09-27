import { createHash, randomBytes } from 'node:crypto';

/** 256 bits from the OS, URL-safe. Unguessable, so nothing about it needs to be secret but itself. */
export function randomToken(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * What the database keeps instead of the token. A dump of the sessions or
 * login-link tables is then a list of hashes, and a hash is not a way in.
 * Unsalted SHA-256 is enough because the input is 256 random bits, not a
 * password somebody chose.
 */
export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

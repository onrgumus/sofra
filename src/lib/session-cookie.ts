/**
 * The session cookie's name, and nothing else.
 *
 * Its own module because the middleware runs on the Edge runtime, where
 * `node:crypto` does not exist. Importing this constant from `session.ts` would
 * drag the signing code, and Node's crypto, into a bundle that cannot have it.
 */
export const SESSION_COOKIE = 'sofra_session';

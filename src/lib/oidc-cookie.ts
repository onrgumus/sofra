/** Kept apart from the routes so the middleware can name it without pulling in
 * the whole OIDC client. */
export const HANDSHAKE_COOKIE = 'sofra_oidc';

/** A sign-in attempt has no business outliving the walk to the provider. */
export const HANDSHAKE_MAX_AGE_MS = 10 * 60 * 1000;

/**
 * Scoped to the routes that use it, so it is not attached to every request.
 *
 * Named here because deleting a cookie only works when the path matches the one
 * it was set with. Clearing it with the default `/` looks like it worked and
 * leaves the original in place until it expires on its own.
 */
export const HANDSHAKE_PATH = '/api/auth/oidc';

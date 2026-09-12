/**
 * Where this instance is reachable. The confirm link goes into an email, so it
 * cannot be a relative path and it cannot be localhost in production.
 */
export const BASE_URL = (process.env.SOFRA_BASE_URL ?? 'http://localhost:3000').replace(/\/+$/, '');

/** Group ids contain a colon (the slot), so they are encoded into the path. */
export function confirmUrl(groupId: string): string {
  return `${BASE_URL}/c/${encodeURIComponent(groupId)}`;
}

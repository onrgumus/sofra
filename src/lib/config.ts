import { envText } from './env';

/**
 * Where this instance is reachable. The confirm link goes into an email, so it
 * cannot be a relative path and it cannot be localhost in production.
 */
export const BASE_URL = envText('SOFRA_BASE_URL', 'http://localhost:3000').replace(/\/+$/, '');

/** The page where somebody at a table sees it and replies. */
export function confirmUrl(tableId: string): string {
  return `${BASE_URL}/c/${encodeURIComponent(tableId)}`;
}

import { envText } from './env';

/**
 * Where this instance is reachable. The confirm link goes into an email, so it
 * cannot be a relative path and it cannot be localhost in production.
 */
export const BASE_URL = envText('SOFRA_BASE_URL', 'http://localhost:3000').replace(/\/+$/, '');

/** Group ids contain a colon (the slot), so they are encoded into the path. */
export function confirmUrl(groupId: string): string {
  return `${BASE_URL}/c/${encodeURIComponent(groupId)}`;
}

/**
 * When the nightly job runs, as an hour of the day in each office's timezone.
 *
 * The page tells people when their table will appear, so this has to agree with
 * whatever actually triggers /api/cron. Change the schedule in vercel.json and
 * change this, or the app starts lying about it.
 */
export const MATCHING_HOUR = envText('SOFRA_MATCHING_HOUR', '17:00');

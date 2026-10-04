import type { Queryable } from '../db';
import { getSetting } from '../data/settings';
import { envOptional } from '../lib/env';

/**
 * A public demo: one instance, filled with an invented company, that anybody
 * may walk into without an address or a password.
 *
 * Two things have to be true before that door opens, so that a stray setting
 * cannot open it on a real company: the deployment says it is a demo
 * (SOFRA_DEMO=true), and the database says it holds the seed's invented
 * company. Only the seed script writes that; nothing in the console can.
 */
export const DEMO_SETTING = 'demo';

export function demoMode(): boolean {
  return envOptional('SOFRA_DEMO') === 'true';
}

export async function isDemoDatabase(db: Queryable): Promise<boolean> {
  return (await getSetting<boolean>(db, DEMO_SETTING, false)) === true;
}

export async function demoOpen(db: Queryable): Promise<boolean> {
  return demoMode() && (await isDemoDatabase(db));
}

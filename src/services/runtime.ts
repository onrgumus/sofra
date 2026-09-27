import { getDb } from '../db';
import { listOffices } from '../data/offices';
import { configuredDirectory } from '../lib/directory';
import { envOptional } from '../lib/env';
import { calendarHintsEnabled, refreshOfficeHints, type GraphGet } from './calendar';
import type { DayDeps } from './days';
import { syncDirectory } from './directory-sync';
import { configuredChannel, FROM_EMAIL, graphClient } from './mail';
import type { TickDeps } from './tick';

/** Graph GET for calendar reads, when this deployment has app credentials and wants them. */
export function calendarGraph(): GraphGet | null {
  if (!calendarHintsEnabled()) return null;
  const graph = graphClient();
  return graph ? (path) => graph('GET', path) : null;
}

/** What the day-to-day actions need: the database, how to reach people, and the time. */
export function dayDeps(now = new Date()): DayDeps {
  return { db: getDb(), channel: configuredChannel(), from: FROM_EMAIL, now };
}

/** What the scheduler needs, with the optional parts switched on by configuration. */
export function tickDeps(now = new Date()): TickDeps {
  const db = getDb();
  const graphGet = calendarGraph();
  return {
    db,
    channel: configuredChannel(),
    from: FROM_EMAIL,
    now,
    ...(graphGet
      ? {
          refreshHints: async (office, date) =>
            refreshOfficeHints(db, graphGet, office, await listOffices(db), date),
        }
      : {}),
    ...(envOptional('SOFRA_DIRECTORY')
      ? {
          syncDirectory: async () => {
            const configured = configuredDirectory(await listOffices(db));
            if (!configured) return {};
            return { ...(await syncDirectory(db, configured.directory, configured.source)) };
          },
        }
      : {}),
  };
}

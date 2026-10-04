/**
 * The scheduler, for Sofra running on one machine: calls the tick every
 * minute, the way a CronJob or Logic App does every fifteen in production.
 * The tick does each job once whatever calls it, so calling it more often only
 * makes an office's morning arrive on the minute, never twice.
 *
 *   npm run scheduler                          against SOFRA_BASE_URL
 *   SOFRA_TICK_SECONDS=15 npm run scheduler    more often
 *
 * Reads SOFRA_BASE_URL and CRON_SECRET from the environment or .env.local.
 */
import { existsSync } from 'node:fs';

interface Action {
  officeId: string | null;
  kind: string;
  date: string;
  status: string;
  summary?: Record<string, unknown>;
  error?: string;
}

if (existsSync('.env.local')) process.loadEnvFile('.env.local');
const base = process.env.SOFRA_BASE_URL ?? 'http://localhost:3000';
const secret = process.env.CRON_SECRET;
const seconds = Number(process.env.SOFRA_TICK_SECONDS ?? 60);

if (!secret) {
  console.error('CRON_SECRET is not set (environment or .env.local); the tick refuses without it.');
  process.exit(1);
}

const clock = (d: Date) => d.toISOString().slice(11, 19);
let lastReport = 0;

async function tick(): Promise<void> {
  const at = new Date();
  try {
    const response = await fetch(new URL('/api/cron/tick', base), {
      method: 'POST',
      headers: { Authorization: `Bearer ${secret}` },
    });
    if (response.status !== 200 && response.status !== 207) {
      console.log(`${clock(at)} UTC  the tick answered ${response.status}`);
      return;
    }
    const { actions } = (await response.json()) as { actions: Action[] };
    for (const a of actions) {
      const detail = a.error ?? (a.summary?.reason as string | undefined) ?? '';
      console.log(
        `${clock(at)} UTC  ${a.kind} ${a.officeId ?? ''} ${a.date}: ${a.status}${detail ? ` (${detail})` : ''}`,
      );
    }
    // A sign of life every quarter of an hour, so a quiet terminal is not a dead one.
    if (actions.length === 0 && at.getTime() - lastReport >= 15 * 60_000) {
      console.log(`${clock(at)} UTC  nothing due`);
      lastReport = at.getTime();
    }
  } catch (error) {
    console.log(`${clock(at)} UTC  could not reach ${base}: ${(error as Error).message}`);
  }
}

console.log(`Calling ${base}/api/cron/tick every ${seconds} s. Ctrl-C stops it.`);
await tick();
setInterval(() => void tick(), seconds * 1000);

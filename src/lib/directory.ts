import { readFile } from 'node:fs/promises';
import type { Employee } from '../core/types';
import { CsvDirectory, staticDirectory, type Directory } from '../directory';
import { envOptional } from './env';

/**
 * Which directory this deployment runs on.
 *
 * `SOFRA_DIRECTORY_CSV` takes a URL or a file path. Unset, the synthetic
 * company is used, which is right for the public demo and wrong for everything
 * else, so the admin console says which one is in effect rather than leaving a
 * company to discover on the first lunch that it matched 240 invented people.
 */
export function configuredDirectory(fallback: readonly Employee[]): Directory {
  const source = envOptional('SOFRA_DIRECTORY_CSV');
  if (!source) return staticDirectory(fallback, 'demo');

  return new CsvDirectory({ load: () => loadCsv(source) });
}

/** True when this deployment is still matching invented people. */
export function usingDemoDirectory(): boolean {
  return envOptional('SOFRA_DIRECTORY_CSV') === undefined;
}

async function loadCsv(source: string): Promise<string> {
  if (!/^https?:\/\//i.test(source)) return readFile(source, 'utf8');

  // No caching here on purpose: the store reads the directory once per process
  // and holds it, so a second fetch would mean somebody changed the wiring.
  const response = await fetch(source, { headers: directoryHeaders() });
  if (!response.ok) {
    throw new Error(`Directory fetch failed: ${response.status} ${response.statusText}`);
  }
  return response.text();
}

/**
 * An export sitting behind a token is the normal case: the list of everyone who
 * works somewhere, with their addresses, is not a thing to leave on an open URL.
 */
function directoryHeaders(): Record<string, string> {
  const token = envOptional('SOFRA_DIRECTORY_TOKEN');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

import { readFile } from 'node:fs/promises';
import { CsvDirectory, EntraDirectory, type Directory } from '../directory';
import type { Office } from '../data/types';
import { envOptional } from './env';
import { createGraphClient } from './graph';

export interface ConfiguredDirectory {
  directory: Directory;
  source: 'entra' | 'csv';
}

/**
 * The company directory Sofra syncs people from, when there is one.
 *
 * Optional: people can equally sign in and fill their details in themselves.
 * With `SOFRA_DIRECTORY=entra` they come from the tenant (User.Read.All, and
 * GroupMember.Read.All for a pilot group); with `SOFRA_DIRECTORY=csv`, from an
 * export at `SOFRA_DIRECTORY_CSV`. Either way the office each person works in
 * is read against the offices an admin has set up, by their location keywords.
 */
export function configuredDirectory(offices: readonly Office[]): ConfiguredDirectory | null {
  const kind = envOptional('SOFRA_DIRECTORY');
  if (!kind) return null;
  if (kind !== 'entra' && kind !== 'csv') {
    throw new Error(`SOFRA_DIRECTORY must be "entra" or "csv", not "${kind}"`);
  }

  const known = new Set(offices.map((o) => o.id));
  const directory = kind === 'entra' ? entraDirectory(offices) : csvDirectory();
  return {
    source: kind,
    directory: {
      name: directory.name,
      // An office id the export has but the admin has not created is no office
      // at all; the person picks theirs at first sign-in.
      listEmployees: async () =>
        (await directory.listEmployees()).map((e) =>
          known.has(e.officeId) ? e : { ...e, officeId: '' },
        ),
    },
  };
}

function entraDirectory(offices: readonly Office[]): Directory {
  const tenantId = envOptional('MS_TENANT_ID');
  const clientId = envOptional('MS_CLIENT_ID');
  const clientSecret = envOptional('MS_CLIENT_SECRET');
  if (!tenantId || !clientId || !clientSecret) {
    throw new Error(
      'SOFRA_DIRECTORY=entra needs MS_TENANT_ID, MS_CLIENT_ID and MS_CLIENT_SECRET, ' +
        'for an app registration with the User.Read.All application permission',
    );
  }

  const seniorityAttribute = envOptional('SOFRA_ENTRA_SENIORITY_ATTRIBUTE');
  if (seniorityAttribute && !/^extensionAttribute([1-9]|1[0-5])$/.test(seniorityAttribute)) {
    throw new Error('SOFRA_ENTRA_SENIORITY_ATTRIBUTE must be extensionAttribute1 to 15');
  }

  const graph = createGraphClient({ tenantId, clientId, clientSecret });
  return new EntraDirectory({
    graphGet: (path) => graph('GET', path),
    officeLocations: officeKeywords(offices),
    groupId: envOptional('SOFRA_ENTRA_GROUP_ID'),
    seniorityAttribute,
    lenient: true,
  });
}

/** Each office recognised by its keywords, and by its own name and id. */
export function officeKeywords(offices: readonly Office[]): Record<string, string[]> {
  return Object.fromEntries(
    offices.map((o) => [o.id, [...new Set([o.id, o.name, ...o.locationKeywords])]]),
  );
}

function csvDirectory(): Directory {
  const source = envOptional('SOFRA_DIRECTORY_CSV');
  if (!source) throw new Error('SOFRA_DIRECTORY=csv needs SOFRA_DIRECTORY_CSV, a URL or a path');
  return new CsvDirectory({ load: () => loadCsv(source) });
}

async function loadCsv(source: string): Promise<string> {
  if (!/^https?:\/\//i.test(source)) return readFile(source, 'utf8');
  const token = envOptional('SOFRA_DIRECTORY_TOKEN');
  const response = await fetch(source, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!response.ok) {
    throw new Error(`Directory fetch failed: ${response.status} ${response.statusText}`);
  }
  return response.text();
}

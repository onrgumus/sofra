import type { Office } from '../store/types';

/**
 * The buildings this deployment matches in.
 *
 * Configuration rather than code, because a company installing Sofra should not
 * have to edit TypeScript to say where its offices are, and because the demo's
 * two invented offices have no business being in anybody's production instance.
 *
 * SOFRA_OFFICES holds JSON: an array of
 *   { id, displayName, timeZone, meetingPoint }
 *
 * The timezone is not decoration. Each office plans its own next working day in
 * its own zone, so Istanbul and Amsterdam do not get yesterday's lunch for part
 * of every day.
 */
export function parseOffices(raw: string | undefined): Office[] | null {
  if (!raw || raw.trim() === '') return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('SOFRA_OFFICES is not valid JSON');
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error('SOFRA_OFFICES must be a non-empty array of offices');
  }

  return parsed.map((entry, index) => toOffice(entry, index));
}

function toOffice(entry: unknown, index: number): Office {
  const where = `SOFRA_OFFICES[${index}]`;
  if (typeof entry !== 'object' || entry === null) {
    throw new Error(`${where} is not an object`);
  }

  const record = entry as Record<string, unknown>;
  const office: Office = {
    id: text(record, 'id', where),
    displayName: text(record, 'displayName', where),
    timeZone: text(record, 'timeZone', where),
    meetingPoint: text(record, 'meetingPoint', where),
  };

  // A bad zone here would not fail until the first invite, at which point the
  // calendar entry is silently at the wrong hour. Better to refuse to boot.
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: office.timeZone });
  } catch {
    throw new Error(`${where}.timeZone is not a valid IANA zone: ${office.timeZone}`);
  }

  return office;
}

function text(record: Record<string, unknown>, key: string, where: string): string {
  const value = record[key];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${where}.${key} is required`);
  }
  return value;
}

import type { Employee, Seniority } from '../core/types';
import { SENIORITY_LADDER } from '../core/types';
import { parseCsv } from '../providers/csv';
import { ENTRA, SLACK } from './identity';
import type { Directory, DirectoryReadResult, DirectoryRowProblem } from './types';

export interface CsvDirectoryOptions {
  /** Returns the raw CSV. A file, an HTTP endpoint, an S3 object, an SFTP drop. */
  load: () => Promise<string>;
  /** Column names, when the export does not use ours. */
  columns?: Partial<Record<Column, string>>;
  /** Called once per unusable row. Default logs a warning. */
  onSkipped?: (problem: DirectoryRowProblem) => void;
}

type Column =
  | 'id'
  | 'displayName'
  | 'email'
  | 'title'
  | 'seniority'
  | 'department'
  | 'team'
  | 'officeId'
  | 'languages'
  | 'tenureMonths'
  | 'interests'
  | 'aliases'
  | 'entraObjectId'
  | 'slackUserId';

const DEFAULT_COLUMNS: Record<Column, string> = {
  id: 'employee_id',
  displayName: 'display_name',
  email: 'email',
  title: 'title',
  seniority: 'seniority',
  department: 'department',
  team: 'team',
  officeId: 'office_id',
  languages: 'languages',
  tenureMonths: 'tenure_months',
  interests: 'interests',
  aliases: 'aliases',
  entraObjectId: 'entra_object_id',
  slackUserId: 'slack_user_id',
};

/**
 * The directory every company can produce on the first day.
 *
 * Not the one anybody should run forever, and that is the point: an export
 * beats an integration that has to clear procurement before a single lunch
 * happens. A real sync lands later, against the same interface, without the
 * rest of the application noticing.
 */
export class CsvDirectory implements Directory {
  readonly name = 'csv';

  constructor(private readonly options: CsvDirectoryOptions) {}

  async listEmployees(): Promise<Employee[]> {
    const { employees, skipped } = await this.read();
    const report = this.options.onSkipped ?? warn;
    for (const problem of skipped) report(problem);
    return employees;
  }

  /** The same read, with the problems returned rather than reported. */
  async read(): Promise<DirectoryReadResult> {
    return readDirectoryCsv(await this.options.load(), this.options.columns);
  }
}

/**
 * One malformed row must not cost a company its whole directory, so rows are
 * skipped individually and counted. A file that is wrong throughout produces a
 * long list of problems and no people, which is a much clearer failure than an
 * exception on line 4,812.
 */
export function readDirectoryCsv(
  input: string,
  overrides?: Partial<Record<Column, string>>,
): DirectoryReadResult {
  const columns = { ...DEFAULT_COLUMNS, ...overrides };
  const employees: Employee[] = [];
  const skipped: DirectoryRowProblem[] = [];
  const seen = new Set<string>();
  // Every address already claimed, primary or alias. Two people sharing one
  // would make sign-in resolve to whichever row was read first.
  const claimed = new Map<string, string>();

  parseCsv(input).forEach((row, index) => {
    // +2: one for the header, one because spreadsheets count from 1.
    const line = index + 2;
    const missing = (['id', 'displayName', 'email', 'department', 'officeId'] as const).filter(
      (key) => !row[columns[key]],
    );
    if (missing.length > 0) {
      skipped.push({ line, reason: `missing ${missing.map((k) => columns[k]).join(', ')}` });
      return;
    }

    const id = row[columns.id]!;
    if (seen.has(id)) {
      // Two rows for one person would be two seats at two tables.
      skipped.push({ line, reason: `duplicate ${columns.id} ${id}` });
      return;
    }
    seen.add(id);

    const seniority = readSeniority(row[columns.seniority]);
    if (row[columns.seniority] && !seniority) {
      skipped.push({
        line,
        reason: `unknown ${columns.seniority} "${row[columns.seniority]}", expected one of ${SENIORITY_LADDER.join(', ')}`,
      });
      return;
    }

    const aliases = readList(row[columns.aliases], []);
    const addresses = [row[columns.email]!, ...aliases].map((a) => a.trim().toLowerCase());
    const collision = addresses.find((a) => claimed.has(a) && claimed.get(a) !== id);
    if (collision) {
      skipped.push({
        line,
        reason: `address ${collision} already belongs to ${claimed.get(collision)!}`,
      });
      seen.delete(id);
      return;
    }
    for (const address of addresses) claimed.set(address, id);

    const externalIds: Record<string, string> = {};
    if (row[columns.entraObjectId]) externalIds[ENTRA] = row[columns.entraObjectId]!;
    if (row[columns.slackUserId]) externalIds[SLACK] = row[columns.slackUserId]!;

    employees.push({
      id,
      displayName: row[columns.displayName]!,
      email: row[columns.email]!,
      department: row[columns.department]!,
      officeId: row[columns.officeId]!,
      // Everything below improves the match and degrades honestly without it.
      title: row[columns.title] || row[columns.department]!,
      seniority: seniority ?? 'mid',
      team: row[columns.team] || row[columns.department]!,
      languages: readList(row[columns.languages], ['en']),
      tenureMonths: readMonths(row[columns.tenureMonths]),
      interests: readList(row[columns.interests], []),
      ...(aliases.length > 0 ? { aliases } : {}),
      ...(Object.keys(externalIds).length > 0 ? { externalIds } : {}),
    });
  });

  return { employees, skipped };
}

/** Accepts the ladder's own words, case and spacing aside. */
function readSeniority(value: string | undefined): Seniority | null {
  const normalised = value?.trim().toLowerCase();
  if (!normalised) return null;
  return SENIORITY_LADDER.find((level) => level === normalised) ?? null;
}

/** Semicolons, because a comma inside a CSV field needs quoting and nobody does. */
function readList(value: string | undefined, fallback: string[]): string[] {
  if (!value) return fallback;

  const items = value
    .split(/[;|]/)
    .map((item) => item.trim().toLowerCase())
    .filter((item) => item !== '');
  return items.length > 0 ? items : fallback;
}

function readMonths(value: string | undefined): number {
  const months = Number.parseInt(value ?? '', 10);
  return Number.isFinite(months) && months >= 0 ? months : 0;
}

function warn(problem: DirectoryRowProblem): void {
  console.warn(`[directory] skipped line ${problem.line}: ${problem.reason}`);
}

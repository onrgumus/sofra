import type {
  AttendanceProvider,
  AttendanceQuery,
  AttendanceRecord,
  EmployeeIdResolver,
} from './types.js';
import { identityResolver } from './types.js';

export interface CsvProviderOptions {
  /** Returns the raw CSV for a day. Usually an SFTP drop or an S3 object. */
  load: (query: AttendanceQuery) => Promise<string>;
  columns?: { employeeId?: string; officeId?: string; date?: string };
  resolveEmployeeId?: EmployeeIdResolver;
}

/**
 * The universal fallback: IT can always export a CSV, even when the desk tool has
 * no API or procurement will not approve one.
 */
export class CsvAttendanceProvider implements AttendanceProvider {
  readonly name = 'csv';

  constructor(private readonly options: CsvProviderOptions) {}

  async getAttendance(query: AttendanceQuery): Promise<AttendanceRecord[]> {
    const cols = {
      employeeId: 'employee_id',
      officeId: 'office_id',
      date: 'date',
      ...this.options.columns,
    };
    const resolve = this.options.resolveEmployeeId ?? identityResolver;
    const rows = parseCsv(await this.options.load(query));

    const records: AttendanceRecord[] = [];
    for (const row of rows) {
      const vendorId = row[cols.employeeId];
      const date = row[cols.date];
      const officeId = row[cols.officeId];
      if (!vendorId || !date || !officeId) continue;

      const employeeId = resolve(vendorId);
      if (!employeeId) continue;
      if (date !== query.date || officeId !== query.officeId) continue;

      records.push({ employeeId, officeId, date });
    }
    return records;
  }
}

/** Minimal RFC 4180 reader: quoted fields, escaped quotes, CRLF. */
export function parseCsv(input: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < input.length; i++) {
    const char = input[i]!;
    if (quoted) {
      if (char === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += char;
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && input[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += char;
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  const [header, ...body] = rows.filter((r) => r.some((c) => c.trim() !== ''));
  if (!header) return [];
  const keys = header.map((h) => h.trim());

  return body.map((cells) =>
    Object.fromEntries(keys.map((key, i) => [key, (cells[i] ?? '').trim()])),
  );
}

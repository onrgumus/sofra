import type { AttendanceProvider, AttendanceQuery, AttendanceRecord } from './types';

/**
 * People tell Sofra directly that they will be in the office.
 *
 * Zero integration, works at every company on day one, and it is the only
 * provider needed to pilot with a single department. Start here; adopt a real
 * feed once the habit exists.
 */
export class ManualAttendanceProvider implements AttendanceProvider {
  readonly name = 'manual';

  constructor(private readonly records: readonly AttendanceRecord[]) {}

  async getAttendance(query: AttendanceQuery): Promise<AttendanceRecord[]> {
    return this.records.filter((r) => r.date === query.date && r.officeId === query.officeId);
  }
}

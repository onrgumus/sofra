import type { AttendanceProvider, AttendanceQuery, AttendanceRecord } from './types.js';

/**
 * For companies whose desk tool can push. They POST attendance to us; we keep the
 * latest snapshot per (date, office) and serve it at matching time.
 *
 * Swap the in-memory map for a table when you deploy — the interface is the
 * point, the storage is not.
 */
export class WebhookAttendanceProvider implements AttendanceProvider {
  readonly name = 'webhook';

  private readonly snapshots = new Map<string, AttendanceRecord[]>();

  /** Replaces the snapshot for that day and office. Idempotent by design. */
  ingest(query: AttendanceQuery, records: readonly AttendanceRecord[]): void {
    const deduped = new Map(records.map((r) => [r.employeeId, r]));
    this.snapshots.set(key(query), [...deduped.values()]);
  }

  async getAttendance(query: AttendanceQuery): Promise<AttendanceRecord[]> {
    return this.snapshots.get(key(query)) ?? [];
  }
}

function key(query: AttendanceQuery): string {
  return `${query.date}|${query.officeId}`;
}

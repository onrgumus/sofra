/**
 * The entire integration surface with a company's desk-booking system.
 *
 * Sofra never asks who booked which desk, what the floor plan looks like, or how
 * bookings are approved. It asks one question: who is in this building on this
 * day? Every vendor can answer that, which is why the product ports without
 * touching the matching engine.
 */
export interface AttendanceRecord {
  /** Must match `Employee.id`. Adapters map vendor ids via `resolveEmployeeId`. */
  employeeId: string;
  officeId: string;
  /** ISO date, e.g. '2026-09-16'. */
  date: string;
}

export interface AttendanceQuery {
  date: string;
  officeId: string;
}

export interface AttendanceProvider {
  /** Stable identifier used in logs and admin UI, e.g. 'manual', 'ms-graph'. */
  readonly name: string;
  getAttendance(query: AttendanceQuery): Promise<AttendanceRecord[]>;
}

/**
 * Vendor ids (badge numbers, Graph object ids, desk-tool user ids) rarely equal
 * our employee ids, so every adapter takes a resolver instead of assuming.
 * Returning null drops the record, which is the right behaviour for contractors
 * and service accounts that are not in the directory.
 */
export type EmployeeIdResolver = (vendorId: string) => string | null;

export const identityResolver: EmployeeIdResolver = (vendorId) => vendorId;

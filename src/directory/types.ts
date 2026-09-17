import type { Employee } from '../core/types';

/**
 * Where a company's people come from.
 *
 * The second of the two seams a company has to fill, and the one that blocks
 * everything: the attendance provider answers "who is in this building today",
 * and this answers "who works here at all". Without it there is nobody to match
 * and the synthetic company is the product.
 *
 * Deliberately one method. Sofra does not want the org chart, the reporting
 * lines, the cost centres or the joiner-mover-leaver events; it wants a list of
 * people with enough on each to seat them next to somebody interesting. Every
 * HR system and every IdP can produce that, which is why an Entra, Workday or
 * SCIM adapter is a small amount of code against this rather than a project.
 */
export interface Directory {
  /** Identifier used in logs and the admin console, e.g. 'csv', 'demo'. */
  readonly name: string;
  listEmployees(): Promise<Employee[]>;
}

/**
 * What a row has to carry, and what it may leave out.
 *
 * Only the first five are required, because they are the ones without which a
 * person cannot be seated or told about it. Everything else improves the match
 * and degrades honestly when missing: no languages means English, no interests
 * means the icebreaker comes from the seniority gap instead, no tenure means
 * zero and the spread simply has less to work with.
 */
export interface DirectoryRowProblem {
  /** 1-based, counting the header, so it matches what a spreadsheet shows. */
  line: number;
  reason: string;
}

export interface DirectoryReadResult {
  employees: Employee[];
  /** Rows that could not be used. Reported rather than thrown: one malformed
   * line in a ten thousand row export should not leave a company with nobody. */
  skipped: DirectoryRowProblem[];
}

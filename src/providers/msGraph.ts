import type {
  AttendanceProvider,
  AttendanceQuery,
  AttendanceRecord,
  EmployeeIdResolver,
} from './types.js';
import { identityResolver } from './types.js';

/** Whatever Graph returned for one calendar entry. Deliberately untyped. */
export type GraphEvent = Record<string, unknown>;

export interface MsGraphProviderOptions {
  /** Graph user ids (or UPNs) to poll, usually the opted-in population only. */
  userIds: () => Promise<string[]>;
  /** Authenticated GET against Graph. Injected so this stays SDK-free and testable. */
  graphGet: (path: string) => Promise<{ value?: GraphEvent[] }>;
  /**
   * Decides whether an event means "in this office that day".
   *
   * IMPORTANT: verify this against the Graph version you target. Outlook's
   * work-location feature has shipped under more than one shape, so the default
   * below checks the ones we have seen and errs towards not counting an event.
   */
  isInOffice?: (event: GraphEvent, query: AttendanceQuery) => boolean;
  resolveEmployeeId?: EmployeeIdResolver;
  /** Only used by the default predicate, to tell buildings apart. */
  officeNamePatterns?: Record<string, RegExp>;
}

/**
 * Reads office presence from Outlook instead of from a desk-booking vendor.
 *
 * This is the adapter that makes the product portable in practice: most desk
 * tools (Envoy, Robin, deskbird, Condeco, OfficeSpace) write the booking back to
 * the user's Outlook calendar or work location. Reading Outlook therefore covers
 * a large share of enterprises without integrating with any of them.
 */
export class MsGraphAttendanceProvider implements AttendanceProvider {
  readonly name = 'ms-graph';

  constructor(private readonly options: MsGraphProviderOptions) {}

  async getAttendance(query: AttendanceQuery): Promise<AttendanceRecord[]> {
    const resolve = this.options.resolveEmployeeId ?? identityResolver;
    const isInOffice = this.options.isInOffice ?? this.defaultPredicate;
    const userIds = await this.options.userIds();

    const start = `${query.date}T00:00:00Z`;
    const end = `${query.date}T23:59:59Z`;

    const perUser = await Promise.all(
      userIds.map(async (userId) => {
        const path =
          `/users/${encodeURIComponent(userId)}/calendarView` +
          `?startDateTime=${start}&endDateTime=${end}&$top=50`;
        let response: { value?: GraphEvent[] };
        try {
          response = await this.options.graphGet(path);
        } catch {
          // One unreadable mailbox must not cancel the whole day's lunches.
          return null;
        }
        const attending = (response.value ?? []).some((event) => isInOffice(event, query));
        if (!attending) return null;

        const employeeId = resolve(userId);
        return employeeId ? { employeeId, officeId: query.officeId, date: query.date } : null;
      }),
    );

    return perUser.filter((r): r is AttendanceRecord => r !== null);
  }

  private readonly defaultPredicate = (event: GraphEvent, query: AttendanceQuery): boolean => {
    const workingLocation = asRecord(event['workingLocation']);
    const locationType =
      asString(event['workingLocationType']) ?? asString(workingLocation?.['type']);
    if (locationType && locationType.toLowerCase() !== 'office') return false;

    const pattern = this.options.officeNamePatterns?.[query.officeId];
    if (!pattern) return locationType?.toLowerCase() === 'office';

    const names = [
      asString(asRecord(event['location'])?.['displayName']),
      asString(workingLocation?.['displayName']),
      asString(event['subject']),
    ].filter((n): n is string => n !== undefined);

    return names.some((name) => pattern.test(name));
  };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

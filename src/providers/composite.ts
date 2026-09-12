import type { AttendanceProvider, AttendanceQuery, AttendanceRecord } from './types';

/**
 * Runs several sources and unions the result.
 *
 * Real rollouts are mixed: the Outlook feed covers most people, a few teams use
 * the desk tool's CSV export, and everyone else just tells the app. One provider
 * failing is not a reason to skip lunch, so failures are logged and skipped.
 */
export class CompositeAttendanceProvider implements AttendanceProvider {
  readonly name = 'composite';

  constructor(
    private readonly providers: readonly AttendanceProvider[],
    private readonly onError: (provider: string, error: unknown) => void = () => {},
  ) {}

  async getAttendance(query: AttendanceQuery): Promise<AttendanceRecord[]> {
    const results = await Promise.all(
      this.providers.map(async (provider) => {
        try {
          return await provider.getAttendance(query);
        } catch (error) {
          this.onError(provider.name, error);
          return [];
        }
      }),
    );

    const merged = new Map<string, AttendanceRecord>();
    for (const record of results.flat()) merged.set(record.employeeId, record);
    return [...merged.values()];
  }
}

import type { Employee } from '../core/types';
import type { Directory } from './types';

/** How long a directory read is good for. Fifteen minutes is short enough that
 * a joiner is seated the same day and long enough that a page view is not an
 * HTTP call to somebody's HR system. */
export const DEFAULT_TTL_MINUTES = 15;

export interface DirectoryCacheOptions {
  directory: Directory;
  ttlMinutes?: number;
  now?: () => number;
  /** Called when a refresh fails and the previous copy is kept. */
  onStale?: (error: unknown) => void;
}

/**
 * The company, re-read now and then.
 *
 * Reading it on every lookup would make one lunch page hundreds of HTTP calls
 * to an HR system. Reading it once per process, which is what this replaced,
 * means a new joiner is invisible until something restarts: on a long-running
 * server that is never, and on a serverless one it is whenever a cold start
 * happens to land, which is not an answer anybody can give their new colleague.
 *
 * A failed refresh keeps the copy it already has. A directory that is briefly
 * unreachable should not empty a building; the alternative is that an HR export
 * being down cancels lunch for everyone.
 */
export class DirectoryCache {
  private employees: Map<string, Employee> | null = null;
  private filledAt = 0;
  private inFlight: Promise<void> | null = null;

  constructor(private readonly options: DirectoryCacheOptions) {}

  async people(): Promise<Map<string, Employee>> {
    const now = (this.options.now ?? Date.now)();
    const ttl = (this.options.ttlMinutes ?? DEFAULT_TTL_MINUTES) * 60_000;

    if (this.employees && now - this.filledAt < ttl) return this.employees;

    // One refresh at a time. Without this, a burst of requests arriving on a
    // cold cache each fetches the whole company.
    this.inFlight ??= this.refresh(now).finally(() => {
      this.inFlight = null;
    });
    await this.inFlight;

    return this.employees ?? new Map();
  }

  private async refresh(now: number): Promise<void> {
    try {
      const list = await this.options.directory.listEmployees();
      this.employees = new Map(list.map((e) => [e.id, e]));
      this.filledAt = now;
    } catch (error) {
      if (!this.employees) throw error;

      // Keep what we have and try again on the next request rather than
      // pretending the company has no staff.
      this.options.onStale?.(error);
      this.filledAt = now;
    }
  }
}

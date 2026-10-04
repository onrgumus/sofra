import { requireAdmin } from '../../../src/auth/session';
import { visibleOffices } from '../../../src/auth/roles';
import { getDb } from '../../../src/db';
import { listRuns } from '../../../src/data/jobs';
import { listOffices } from '../../../src/data/offices';
import { formatDay } from '../../../src/lib/dates';
import { formatLocalTime, localNow } from '../../../src/lib/zoned';
import { Pill } from '../../ui';
import { dayLabel, jobLabel, runSummary } from '../describe';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Runs · Sofra' };

/** What the scheduler did, office by office, and why anything did not happen. */
export default async function RunsPage() {
  const { role } = await requireAdmin();
  const db = getDb();
  const offices = visibleOffices(role, await listOffices(db));
  const runs = await listRuns(
    db,
    role.everyOffice ? { limit: 150 } : { officeIds: offices.map((o) => o.id), limit: 150 },
  );
  const names = new Map(offices.map((o) => [o.id, o.name]));
  const zones = new Map(offices.map((o) => [o.id, o.timeZone]));
  // On the office's own clock, as everything else in the console is.
  const when = (startedAt: string, officeId: string | null) => {
    const zone = (officeId && zones.get(officeId)) || 'UTC';
    const at = new Date(startedAt);
    return `${formatDay(localNow(zone, at).date)}, ${formatLocalTime(at, zone)}${zone === 'UTC' ? ' UTC' : ''}`;
  };

  return (
    <main>
      <div className="page-head">
        <h1>Runs</h1>
        <p>
          Every job the scheduler ran, or chose not to, and every one run by hand. A failed job is
          tried again on the next ticks, up to three times.
        </p>
      </div>
      <div className="card">
        <table className="data">
          <thead>
            <tr>
              <th>When</th>
              <th>Job</th>
              <th>Office</th>
              <th>For</th>
              <th>Result</th>
              <th>Details</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((r) => (
              <tr key={r.id}>
                <td title={`${r.startedAt.slice(0, 16).replace('T', ' ')} UTC`}>
                  {when(r.startedAt, r.officeId)}
                </td>
                <td>
                  {jobLabel(r.kind)}
                  {r.trigger === 'manual' ? <span className="faint"> · by hand</span> : null}
                </td>
                <td>{r.officeId ? (names.get(r.officeId) ?? r.officeId) : 'company'}</td>
                <td>{dayLabel(r.runKey)}</td>
                <td>
                  <Pill
                    tone={
                      r.status === 'done'
                        ? 'good'
                        : r.status === 'failed'
                          ? 'bad'
                          : r.status === 'skipped'
                            ? 'warn'
                            : 'neutral'
                    }
                  >
                    {r.status}
                  </Pill>
                  {r.attempts > 1 ? <span className="faint"> · attempt {r.attempts}</span> : null}
                </td>
                <td className="faint small" title={r.error ?? JSON.stringify(r.summary)}>
                  {r.error ?? runSummary(r.kind, r.summary)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {runs.length === 0 ? <p className="faint">Nothing has run yet.</p> : null}
      </div>
    </main>
  );
}

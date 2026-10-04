import { requireAdmin } from '../../../src/auth/session';
import { getDb } from '../../../src/db';
import { listAudit } from '../../../src/data/admin';
import { listOffices } from '../../../src/data/offices';
import { formatDay } from '../../../src/lib/dates';
import { formatLocalTime, localNow } from '../../../src/lib/zoned';
import { actionLabel, auditSummary } from '../describe';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Audit log · Sofra' };

/** Who changed what in the console, and when. Nothing here can be edited or removed. */
export default async function AuditPage() {
  const { person } = await requireAdmin({ everyOffice: true });
  const db = getDb();
  const [entries, offices] = await Promise.all([listAudit(db, { limit: 200 }), listOffices(db)]);
  const names = new Map(offices.map((o) => [o.id, o.name]));
  const officeName = (id: string) => names.get(id) ?? id;
  // On the clock of the office the reader works in, like the rest of the console.
  const zone = offices.find((o) => o.id === person.officeId)?.timeZone ?? 'UTC';
  const when = (at: string) =>
    `${formatDay(localNow(zone, new Date(at)).date)}, ${formatLocalTime(new Date(at), zone)}${zone === 'UTC' ? ' UTC' : ''}`;

  return (
    <main>
      <div className="page-head">
        <h1>Audit log</h1>
        <p>Every change made in the console, with who made it.</p>
      </div>
      <div className="card">
        <table className="data">
          <thead>
            <tr>
              <th>When</th>
              <th>Who</th>
              <th>What</th>
              <th>On</th>
              <th>Details</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.id}>
                <td title={`${e.at.slice(0, 16).replace('T', ' ')} UTC`}>{when(e.at)}</td>
                <td>{e.actorEmail}</td>
                <td>{actionLabel(e.action)}</td>
                <td>{e.target ? (names.get(e.target) ?? e.target) : ''}</td>
                <td className="faint small" title={JSON.stringify(e.details)}>
                  {auditSummary(e.action, e.details, officeName)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {entries.length === 0 ? <p className="faint">Nothing yet.</p> : null}
      </div>
    </main>
  );
}

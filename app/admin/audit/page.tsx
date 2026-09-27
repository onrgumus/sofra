import { requireAdmin } from '../../../src/auth/session';
import { getDb } from '../../../src/db';
import { listAudit } from '../../../src/data/admin';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Audit log · Sofra' };

/** Who changed what in the console, and when. Nothing here can be edited or removed. */
export default async function AuditPage() {
  await requireAdmin({ everyOffice: true });
  const entries = await listAudit(getDb(), { limit: 200 });

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
              <th>When (UTC)</th>
              <th>Who</th>
              <th>What</th>
              <th>On</th>
              <th>Details</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.id}>
                <td className="mono">{e.at.slice(0, 16).replace('T', ' ')}</td>
                <td>{e.actorEmail}</td>
                <td className="mono">{e.action}</td>
                <td>{e.target}</td>
                <td className="faint small truncate" title={JSON.stringify(e.details)}>
                  {JSON.stringify(e.details).slice(0, 160)}
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

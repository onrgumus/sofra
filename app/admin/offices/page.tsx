import Link from 'next/link';
import { requireAdmin } from '../../../src/auth/session';
import { visibleOffices } from '../../../src/auth/roles';
import { getDb } from '../../../src/db';
import { listOffices } from '../../../src/data/offices';
import { formatLocalTime } from '../../../src/lib/zoned';
import { WEEKDAYS } from '../../../src/services/forms';
import { matchInstant, officeToday } from '../../../src/services/schedule';
import { Pill } from '../../ui';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Offices · Sofra' };

export default async function OfficesPage() {
  const { role } = await requireAdmin();
  const offices = visibleOffices(role, await listOffices(getDb()));
  const now = new Date();

  return (
    <main>
      <div className="page-head spread">
        <div>
          <h1>Offices</h1>
          <p>Each office plans its lunches in its own time zone, on its own timetable.</p>
        </div>
        {role.everyOffice ? (
          <Link className="button" data-variant="primary" href="/admin/offices/new">
            Add an office
          </Link>
        ) : null}
      </div>

      {offices.length === 0 ? (
        <div className="note">No offices yet.</div>
      ) : (
        <div className="card">
          <table className="data">
            <thead>
              <tr>
                <th>Office</th>
                <th>Time zone</th>
                <th>Opens</th>
                <th>Tables made</th>
                <th>Lunch</th>
                <th>Days</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {offices.map((o) => (
                <tr key={o.id}>
                  <td>
                    <Link href={`/admin/offices/${encodeURIComponent(o.id)}`}>{o.name}</Link>{' '}
                    <span className="faint mono">{o.id}</span>
                  </td>
                  <td>{o.timeZone}</td>
                  <td>{o.opensAt}</td>
                  <td>{formatLocalTime(matchInstant(o, officeToday(o, now)), o.timeZone)}</td>
                  <td>{o.lunchSlots.join(', ')}</td>
                  <td>
                    {WEEKDAYS.filter((d) => o.workingDays.includes(d.day))
                      .map((d) => d.short)
                      .join(' ')}
                  </td>
                  <td>{o.active ? null : <Pill tone="neutral">paused</Pill>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}

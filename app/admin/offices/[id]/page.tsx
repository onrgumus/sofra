import { notFound } from 'next/navigation';
import { requireAdmin } from '../../../../src/auth/session';
import { getDb } from '../../../../src/db';
import { getOffice, listHolidays } from '../../../../src/data/offices';
import { formatDay } from '../../../../src/lib/dates';
import { addDays, formatLocalTime, timeZones } from '../../../../src/lib/zoned';
import {
  confirmInstant,
  matchInstant,
  officeToday,
  previousWorkingDay,
  reminderInstant,
  workingDaysFrom,
} from '../../../../src/services/schedule';
import { addHolidayAction, removeHolidayAction } from '../../../actions/admin';
import { OfficeForm } from '../../OfficeForm';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Office · Sofra' };

function utc(instant: Date): string {
  return `${instant.toISOString().slice(0, 10)} ${instant.toISOString().slice(11, 16)} UTC`;
}

export default async function OfficePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const { id } = await params;
  const officeId = decodeURIComponent(id);
  await requireAdmin({ officeId });
  const { saved, error } = await searchParams;
  const db = getDb();
  const office = await getOffice(db, officeId);
  if (!office) notFound();

  const today = officeToday(office, new Date());
  const holidays = await listHolidays(db, office.id, { from: addDays(today, -7) });
  const holidaySet = new Set(holidays.map((h) => h.date));
  const next = workingDaysFrom(office, today, 5, holidaySet);

  return (
    <main>
      <div className="page-head">
        <h1>{office.name}</h1>
        <p>
          It is {today} there. Every time below is in {office.timeZone}.
        </p>
      </div>

      {saved ? (
        <div className="note" data-tone="good" role="status">
          Saved.
        </div>
      ) : null}

      <section>
        <div className="section-head">
          <h2>The next five working days</h2>
          <p>What the scheduler will do, as it stands, with the server&apos;s UTC beside it.</p>
        </div>
        <div className="card">
          <table className="data">
            <thead>
              <tr>
                <th>Lunch day</th>
                <th>Evening question</th>
                <th>Tables made</th>
                <th>Replies close</th>
              </tr>
            </thead>
            <tbody>
              {next.map((d) => (
                <tr key={d}>
                  <td>{formatDay(d)}</td>
                  <td title={utc(reminderInstant(office, d, holidaySet))}>
                    {formatDay(previousWorkingDay(office, d, holidaySet))} {office.reminderAt}
                  </td>
                  <td title={utc(matchInstant(office, d))}>
                    {formatLocalTime(matchInstant(office, d), office.timeZone)}{' '}
                    <span className="faint">({utc(matchInstant(office, d)).slice(11)})</span>
                  </td>
                  <td>{formatLocalTime(confirmInstant(office, d), office.timeZone)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <div className="section-head">
          <h2>Settings</h2>
        </div>
        <OfficeForm
          existingId={office.id}
          timeZones={timeZones()}
          initial={{
            ...office,
            lunchSlots: office.lunchSlots.join(', '),
            locationKeywords: office.locationKeywords.join(', '),
          }}
        />
      </section>

      <section id="holidays">
        <div className="section-head">
          <h2>Holidays</h2>
          <p>
            No lunch is planned on these days, and the evening question moves to the day before.
          </p>
        </div>
        <div className="card stack">
          {error === 'date' ? <p className="error-text">That is not a date.</p> : null}
          {holidays.length === 0 ? <p className="faint">None yet.</p> : null}
          <ul className="plain">
            {holidays.map((h) => (
              <li key={h.date} className="row spread">
                <span>
                  {formatDay(h.date)} {h.date.slice(0, 4)} {h.name ? `· ${h.name}` : ''}
                </span>
                <form action={removeHolidayAction}>
                  <input type="hidden" name="officeId" value={office.id} />
                  <input type="hidden" name="date" value={h.date} />
                  <button type="submit" data-variant="quiet">
                    Remove
                  </button>
                </form>
              </li>
            ))}
          </ul>
          <form action={addHolidayAction} className="inline">
            <input type="hidden" name="officeId" value={office.id} />
            <input type="date" name="date" required aria-label="Holiday date" />
            <input name="name" placeholder="Name, e.g. Republic Day" aria-label="Holiday name" />
            <button type="submit">Add holiday</button>
          </form>
        </div>
      </section>
    </main>
  );
}

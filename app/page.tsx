import Link from 'next/link';
import { getStore } from '../src/store/instance';
import { SLOT } from '../src/store/demo';
import { formatDay, todayInZone, upcomingWeekdays } from '../src/lib/dates';
import type { StoredGroup } from '../src/store/types';
import { setAttendance, toggleLunch } from './actions';
import { AutoSubmitCheckbox } from './AutoSubmit';
import { Pill, PersonRow } from './ui';

// Reads mutable store state on every request, so it must never be prerendered.
export const dynamic = 'force-dynamic';

export default async function EmployeePage() {
  const store = getStore();
  const employeeId = store.getCurrentEmployeeId();
  const me = store.getEmployee(employeeId);
  const office = me ? store.getOffice(me.officeId) : undefined;

  if (!me || !office) return <p>No employee selected.</p>;

  const days = await Promise.all(
    upcomingWeekdays(10, todayInZone(office.timeZone)).map(async (date) => {
      const source = await store.attendanceSource(employeeId, date, office.id);
      return {
        date,
        source,
        // An opt-in only means anything on a day you are actually in the office.
        optIn: source === null ? null : store.getOptIn(employeeId, date, office.id),
        group: store.groupForEmployee(employeeId, date, office.id),
        /** Tables for this day already exist, so the cut-off has passed. */
        matched: store.listGroups(date, office.id).length > 0,
      };
    }),
  );

  return (
    <main>
      <div className="page-head">
        <h1>Lunch with people you would never otherwise meet</h1>
        <p>
          Plenty of office days you are there to sit with your own team and get work done. On the
          days you would rather not, tick the box and Sofra seats you with three colleagues from
          other teams — different departments, different seniority, people you have not had lunch
          with before. One day at a time; nothing is automatic.
        </p>
      </div>

      <section>
        <div className="section-head">
          <h2>The next two weeks</h2>
          <p>
            Office days come from your company's desk-booking system. You can also just tell us.
          </p>
        </div>

        <div className="stack">
          {days.map((day) => (
            <article className="day" key={day.date} data-attending={day.source !== null}>
              <div className="day-date">
                {formatDay(day.date).split(' ')[0]}
                <small>{formatDay(day.date).split(' ').slice(1).join(' ')}</small>
              </div>

              <div className="day-body">
                <div className="row">
                  {day.source === null ? (
                    <Pill tone="neutral">Not in the office</Pill>
                  ) : (
                    <>
                      <Pill tone="accent">In the office</Pill>
                      <span className="faint">
                        {day.source === 'desk-booking'
                          ? 'from your desk booking'
                          : 'you told us'}
                      </span>
                    </>
                  )}

                  {day.optIn ? <Pill tone="good">Lunch at {SLOT}</Pill> : null}
                  {day.group?.cancelled ? <Pill tone="bad">Table cancelled</Pill> : null}
                </div>

                {day.group ? (
                  <TablePreview group={day.group} meId={employeeId} />
                ) : day.optIn ? (
                  <p className="faint" style={{ marginTop: 6 }}>
                    {day.matched
                      ? 'Tables for this day were already set before you asked, so there is no seat for you today. Your tick still counts if matching runs again.'
                      : 'Matching runs the evening before. Your table — three people, their names and what they do — will appear here.'}
                  </p>
                ) : null}
              </div>

              <div className="day-actions">
                {day.source === null ? (
                  <form action={setAttendance}>
                    <input type="hidden" name="employeeId" value={employeeId} />
                    <input type="hidden" name="date" value={day.date} />
                    <input type="hidden" name="officeId" value={office.id} />
                    <input type="hidden" name="attending" value="true" />
                    <button type="submit">I'll be in</button>
                  </form>
                ) : day.group ? (
                  <Link className="button" href={`/c/${encodeURIComponent(day.group.id)}`}>
                    Open invite
                  </Link>
                ) : (
                  <>
                    <form action={toggleLunch} className="inline">
                      <input type="hidden" name="employeeId" value={employeeId} />
                      <input type="hidden" name="date" value={day.date} />
                      <input type="hidden" name="officeId" value={office.id} />
                      <AutoSubmitCheckbox
                        name="wantsLunch"
                        defaultChecked={day.optIn !== null}
                        label="Meet other teams today"
                        title="Sofra will seat you with three people from other teams at 12:00. Untick any time before the evening before."
                      />
                    </form>
                    <form action={setAttendance}>
                      <input type="hidden" name="employeeId" value={employeeId} />
                      <input type="hidden" name="date" value={day.date} />
                      <input type="hidden" name="officeId" value={office.id} />
                      <input type="hidden" name="attending" value="false" />
                      <button type="submit" data-variant="quiet" title="Plans changed">
                        Not in
                      </button>
                    </form>
                  </>
                )}
              </div>
            </article>
          ))}
        </div>
      </section>

      <section>
        <div className="note">
          Matching runs the evening before, and everyone who ticked the box that day is split
          evenly into tables of three or four. One mail goes to the whole table at once, with a
          topic to start on. Nobody sees who opted in and attendance is not reported to anyone. If
          a table drops below three people, whoever still wants lunch is moved to another table
          rather than left with nothing.
        </div>
      </section>
    </main>
  );
}

function TablePreview({ group, meId }: { group: StoredGroup; meId: string }) {
  const others = group.members.filter((m) => m.id !== meId);

  return (
    <div style={{ marginTop: 10 }}>
      <div className="faint">
        {group.cancelled
          ? 'Too many people dropped out and there was no free seat at another table, so this one is off.'
          : `You are seated with ${others.length} people from ${
              new Set(others.map((m) => m.department)).size
            } other departments.`}
      </div>
      <div className="people">
        {others.map((person) => (
          <PersonRow key={person.id} person={person} rsvp={group.rsvps[person.id]} />
        ))}
      </div>
    </div>
  );
}

import Link from 'next/link';
import { getStore } from '../src/store/instance';
import { currentEmployeeId } from '../src/lib/session';
import { redirect } from 'next/navigation';
import { SLOT } from '../src/store/demo';
import {
  cutOffPassed,
  formatDay,
  previousWeekday,
  todayInZone,
  upcomingWeekdays,
} from '../src/lib/dates';
import { MATCHING_HOUR } from '../src/lib/config';
import type { StoredGroup } from '../src/store/types';
import { setAttendance, toggleLunch } from './actions';
import { AutoSubmitCheckbox } from './AutoSubmit';
import { Pill, PersonRow } from './ui';

// Reads mutable store state on every request, so it must never be prerendered.
export const dynamic = 'force-dynamic';

export default async function EmployeePage({
  searchParams,
}: {
  searchParams: Promise<{ day?: string }>;
}) {
  const store = getStore();
  // The reminder mail links straight at one day, so it opens on the day it was
  // asking about rather than on a list the reader has to search.
  const { day: highlighted } = await searchParams;
  const employeeId = await currentEmployeeId(store);
  if (!employeeId) redirect('/login');

  const me = await store.getEmployee(employeeId);
  const office = me ? await store.getOffice(me.officeId) : undefined;

  if (!me || !office) return <p>No employee selected.</p>;

  const days = await Promise.all(
    upcomingWeekdays(10, todayInZone(office.timeZone)).map(async (date) => {
      const source = await store.attendanceSource(employeeId, date, office.id);
      return {
        date,
        source,
        // An opt-in only means anything on a day you are actually in the office.
        optIn: source === null ? null : await store.getOptIn(employeeId, date, office.id),
        group: await store.groupForEmployee(employeeId, date, office.id),
        /** Tables for this day already exist, so the cut-off has passed. */
        matched: (await store.listGroups(date, office.id)).length > 0,
        /**
         * Whether the evening the matching runs is already behind us. Without
         * this the page told anybody ticking today's box to wait for 17:00 on
         * the previous weekday, which is a moment that has been and gone.
         */
        tooLate: cutOffPassed(date, office.timeZone, MATCHING_HOUR),
        /**
         * Why the engine could not seat you. Being told nothing was the worst
         * outcome the product had: you tick the box, no table appears, and you
         * are left to conclude that nobody wanted to eat with you.
         */
        unseated:
          (await store.listUnmatched(date, office.id)).find((u) => u.employee.id === employeeId)
            ?.reason ?? null,
      };
    }),
  );

  return (
    <main>
      <div className="page-head">
        <h1>Your lunches</h1>
        <p>Tick a day you are in the office and you will eat with three people from other teams.</p>
      </div>

      <section>
        <div className="section-head">
          <h2>The next two weeks</h2>
        </div>

        <div className="stack">
          {days.map((day) => (
            <article
              className="day"
              key={day.date}
              id={day.date}
              data-attending={day.source !== null}
              data-highlight={day.date === highlighted}
            >
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
                        {day.source === 'desk-booking' ? 'from your desk booking' : 'you told us'}
                      </span>
                    </>
                  )}

                  {/* Your own reply, on the page you actually come back to.
                      Having declined a lunch and then seeing an unchanged green
                      pill and your table-mates is the app disagreeing with you
                      about something you told it. */}
                  {day.group && day.group.rsvps[employeeId] === 'declined' ? (
                    <Pill tone="bad">You are not going</Pill>
                  ) : day.group && day.group.rsvps[employeeId] === 'accepted' ? (
                    <Pill tone="good">You are going, {SLOT}</Pill>
                  ) : day.optIn ? (
                    <Pill tone="good">Lunch at {SLOT}</Pill>
                  ) : null}
                  {day.group?.cancelled ? <Pill tone="bad">Table cancelled</Pill> : null}
                </div>

                {day.group ? (
                  <TablePreview group={day.group} meId={employeeId} />
                ) : day.optIn ? (
                  <p className="faint" style={{ marginTop: 6 }}>
                    {day.unseated === 'no-common-language'
                      ? 'Nobody else asking for a lunch that day shares a language with you. Your languages are on your details page, and adding one you are comfortable in is usually enough.'
                      : day.unseated === 'pool-too-small'
                        ? 'Too few people asked that day to make a table. Your tick still counts if matching runs again.'
                        : day.matched
                          ? 'Tables for that day were set before you asked, so there is no seat for you. Your tick still counts if matching runs again.'
                          : day.tooLate
                            ? `Tables for that day are put together at ${MATCHING_HOUR} the evening before, which has passed. Your tick still counts if matching runs again.`
                            : `Your table appears here after ${MATCHING_HOUR} on ${formatDay(previousWeekday(day.date))}, and the invite reaches you by email at the same time.`}
                  </p>
                ) : null}
              </div>

              <div className="day-actions">
                {day.source === null ? (
                  <form action={setAttendance}>
                    <input type="hidden" name="date" value={day.date} />
                    <input type="hidden" name="officeId" value={office.id} />
                    <input type="hidden" name="attending" value="true" />
                    <button type="submit">I&apos;ll be in</button>
                  </form>
                ) : day.group ? (
                  <Link className="button" href={`/c/${encodeURIComponent(day.group.id)}`}>
                    Open invite
                  </Link>
                ) : (
                  <>
                    <form action={toggleLunch} className="inline">
                      <input type="hidden" name="date" value={day.date} />
                      <input type="hidden" name="officeId" value={office.id} />
                      <AutoSubmitCheckbox
                        name="wantsLunch"
                        focusKey={day.date}
                        defaultChecked={day.optIn !== null}
                        // Not "today": the row it sits in already says which
                        // day, and every row said today, including next week's.
                        label="Meet other teams"
                        title="Sofra will seat you with three people from other teams at 12:00. Untick any time before the evening before."
                      />
                    </form>
                    <form action={setAttendance}>
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
          Nobody sees who ticked the box, and your office days are not reported to anyone.
        </div>
      </section>
    </main>
  );
}

function TablePreview({ group, meId }: { group: StoredGroup; meId: string }) {
  const others = group.members.filter((m) => m.id !== meId);

  return (
    <div style={{ marginTop: 10 }}>
      {/* The names are the answer. Counting the departments for them is the
          engine talking about itself. */}
      {group.cancelled ? (
        <div className="faint">
          Too many people dropped out and there was no free seat at another table, so this one is
          off.
        </div>
      ) : group.rsvps[meId] === 'declined' ? (
        <div className="faint">
          You told this table you cannot make it. They are still going; open the invite if you
          change your mind.
        </div>
      ) : null}
      <div className="people">
        {others.map((person) => (
          <PersonRow key={person.id} person={person} rsvp={group.rsvps[person.id]} />
        ))}
      </div>
    </div>
  );
}

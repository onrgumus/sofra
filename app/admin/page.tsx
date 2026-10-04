import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireAdmin } from '../../src/auth/session';
import { visibleOffices } from '../../src/auth/roles';
import { scoreGroup } from '../../src/core/scoring';
import { MatchHistory } from '../../src/core/history';
import { getDb } from '../../src/db';
import { lastRun } from '../../src/data/jobs';
import { requestsForDay } from '../../src/data/lunch';
import { listHolidays, listOffices } from '../../src/data/offices';
import { countPeople, getPeople } from '../../src/data/people';
import { listTables, listUnseated, pastMatches } from '../../src/data/tables';
import { formatDay } from '../../src/lib/dates';
import { addDays, formatLocalTime } from '../../src/lib/zoned';
import { officeConfig } from '../../src/services/planning';
import {
  confirmInstant,
  dayPhase,
  isWorkingDay,
  matchInstant,
  officeToday,
  previousWorkingDay,
  reminderInstant,
  workingDaysFrom,
} from '../../src/services/schedule';
import { planNowAction, remindNowAction } from '../actions/admin';
import { AutoSubmitSelect } from '../AutoSubmit';
import { Metric, PersonRow, Pill, relaxationLabel, relaxationTone, ScoreBars } from '../ui';
import { runSummary } from './describe';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Console · Sofra' };

const NOTES: Record<string, string> = {
  planned: 'The tables are made and the invites have gone.',
  reminded: 'The reminder has gone to the people likely to want it.',
  failed: 'That did not work. The run is in Runs with the reason.',
};

function utc(instant: Date): string {
  return instant.toISOString().slice(11, 16);
}

/** 180 → "3 hours", 90 → "1 hour 30 minutes". */
function duration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return [h ? `${h} hour${h === 1 ? '' : 's'}` : '', m ? `${m} minutes` : '']
    .filter(Boolean)
    .join(' ');
}

export default async function ConsolePage({
  searchParams,
}: {
  searchParams: Promise<{ office?: string; date?: string; note?: string }>;
}) {
  const { person, role } = await requireAdmin();
  const params = await searchParams;
  const db = getDb();
  const offices = visibleOffices(role, await listOffices(db));

  if (offices.length === 0) {
    return (
      <main>
        <div className="page-head">
          <h1>Console</h1>
          <p>There are no offices yet. Everything starts with one.</p>
        </div>
        {role.everyOffice ? (
          <Link className="button" data-variant="primary" href="/admin/offices/new">
            Add the first office
          </Link>
        ) : null}
      </main>
    );
  }

  // Without a choice, the admin's own office, when theirs to see.
  const office =
    offices.find((o) => o.id === params.office) ??
    offices.find((o) => o.id === person.officeId) ??
    offices[0]!;
  const now = new Date();
  const today = officeToday(office, now);
  const holidays = new Set(
    (await listHolidays(db, office.id, { from: addDays(today, -30), to: addDays(today, 60) })).map(
      (h) => h.date,
    ),
  );
  const upcoming = workingDaysFrom(office, today, 10, holidays);
  const recent = workingDaysFrom(office, addDays(today, -14), 20, holidays).filter(
    (d) => d < today,
  );
  const dates = [...recent.slice(-5), ...upcoming];
  const date = params.date && dates.includes(params.date) ? params.date : (upcoming[0] ?? today);
  if (params.date && params.date !== date)
    redirect(`/admin?office=${encodeURIComponent(office.id)}`);

  const [requests, tables, unseated, matchRun, reminderRun, people] = await Promise.all([
    requestsForDay(db, office.id, date),
    listTables(db, office.id, date),
    listUnseated(db, office.id, date),
    lastRun(db, { kind: 'match', officeId: office.id, runKey: date }),
    lastRun(db, { kind: 'reminder', officeId: office.id, runKey: date }),
    countPeople(db),
  ]);
  const requesters = await getPeople(
    db,
    requests.map((r) => r.employeeId),
  );
  const history = new MatchHistory(await pastMatches(db, date), date);
  const config = officeConfig(office);
  const phase = dayPhase(office, date, holidays, now, tables.length > 0);
  const seated = tables.filter((t) => !t.cancelled).reduce((n, t) => n + t.members.length, 0);

  return (
    <main>
      <div className="page-head">
        <h1>Console</h1>
        <p>
          Tables for a day at {office.name} are made at{' '}
          <strong>{formatLocalTime(matchInstant(office, date), office.timeZone)}</strong> local (
          {utc(matchInstant(office, date))} UTC), {duration(office.matchLeadMinutes)} before the
          office opens at {office.opensAt}. Replies close at{' '}
          {formatLocalTime(confirmInstant(office, date), office.timeZone)}; the evening question
          goes at {office.reminderAt} on {formatDay(previousWorkingDay(office, date, holidays))}.
        </p>
      </div>

      {params.note && NOTES[params.note] ? (
        <div className="note" data-tone={params.note === 'failed' ? 'bad' : 'good'} role="status">
          {NOTES[params.note]}
        </div>
      ) : null}

      <section>
        <form method="get" action="/admin" className="inline">
          {offices.length > 1 ? (
            <AutoSubmitSelect
              name="office"
              defaultValue={office.id}
              aria-label="Office"
              options={offices.map((o) => ({ value: o.id, label: o.name }))}
            />
          ) : null}
          <AutoSubmitSelect
            name="date"
            defaultValue={date}
            aria-label="Day"
            options={dates.map((d) => ({
              value: d,
              label: `${formatDay(d)}${d === today ? ' (today)' : ''}`,
            }))}
          />
        </form>
      </section>

      <section className="metrics">
        <Metric value={requests.length} label="asked for lunch" />
        <Metric value={tables.filter((t) => !t.cancelled).length} label="tables" />
        <Metric value={seated} label="seated" />
        <Metric value={unseated.length} label="could not be seated" />
        <Metric value={`${people.onboarded}/${people.active}`} label="people set up" />
      </section>

      <section>
        <div className="card stack">
          <div className="row">
            <Pill tone={phase === 'open' ? 'accent' : phase === 'matched' ? 'good' : 'neutral'}>
              {phase === 'open'
                ? 'collecting requests'
                : phase === 'matched'
                  ? 'tables made, replies open'
                  : phase === 'closed'
                    ? 'replies closed'
                    : phase === 'past'
                      ? 'over'
                      : 'office closed'}
            </Pill>
            {matchRun ? (
              <span className="faint">
                {matchRun.status === 'skipped'
                  ? 'Tables not made: '
                  : matchRun.status === 'failed'
                    ? 'Making the tables failed: '
                    : matchRun.status === 'running'
                      ? 'Making the tables now… '
                      : `Tables made${matchRun.trigger === 'manual' ? ' by hand' : ''} at ${formatLocalTime(new Date(matchRun.startedAt), office.timeZone)}: `}
                {matchRun.error ?? runSummary('match', matchRun.summary)}
              </span>
            ) : (
              <span className="faint">
                Tables not made yet
                {isWorkingDay(office, date, holidays) ? '' : ' (the office is closed)'}.
              </span>
            )}
            {reminderRun ? (
              <span className="faint">
                Evening question
                {reminderRun.status === 'done' ? (
                  <>
                    {' '}
                    (
                    {reminderRun.trigger === 'manual'
                      ? `sent by hand at ${formatLocalTime(new Date(reminderRun.startedAt), office.timeZone)}`
                      : `${formatDay(previousWorkingDay(office, date, holidays))} ${office.reminderAt}`}
                    ): {runSummary('reminder', reminderRun.summary)}
                  </>
                ) : (
                  <>: {reminderRun.error ?? runSummary('reminder', reminderRun.summary)}</>
                )}
                .
              </span>
            ) : !isWorkingDay(office, date, holidays) ? null : reminderInstant(
                office,
                date,
                holidays,
              ).getTime() > now.getTime() ? (
              <span className="faint">
                Evening question due {formatDay(previousWorkingDay(office, date, holidays))}{' '}
                {office.reminderAt}.
              </span>
            ) : (
              <span className="faint">
                The evening question was due {formatDay(previousWorkingDay(office, date, holidays))}{' '}
                {office.reminderAt} and did not go out.
              </span>
            )}
          </div>
          {phase !== 'past' && phase !== 'off' ? (
            <div className="row">
              <form action={planNowAction}>
                <input type="hidden" name="officeId" value={office.id} />
                <input type="hidden" name="date" value={date} />
                <button type="submit" data-variant="primary">
                  {tables.length > 0 ? 'Make the tables again' : 'Make the tables now'}
                </button>
              </form>
              {phase === 'open' ? (
                <form action={remindNowAction}>
                  <input type="hidden" name="officeId" value={office.id} />
                  <input type="hidden" name="date" value={date} />
                  <button type="submit">Send the reminder now</button>
                </form>
              ) : null}
              {tables.length > 0 ? (
                <span className="faint">
                  Making them again cancels the invites already sent and sends new ones.
                </span>
              ) : null}
            </div>
          ) : null}
        </div>
      </section>

      {tables.length > 0 ? (
        <section>
          <div className="section-head">
            <h2>Tables</h2>
          </div>
          <div className="grid-2">
            {tables.map((table, i) => (
              <article className="card" key={table.id}>
                <div className="spread">
                  <h3>
                    Table {i + 1} · {table.slot}
                  </h3>
                  <div className="row">
                    {table.cancelled ? <Pill tone="bad">cancelled</Pill> : null}
                    <Pill tone={relaxationTone(table.relaxation)}>
                      {relaxationLabel(table.relaxation)}
                    </Pill>
                  </div>
                </div>
                <div className="people">
                  {table.members.map((m) => (
                    <PersonRow key={m.id} person={m} rsvp={table.rsvps[m.id]} detail="full" />
                  ))}
                </div>
                {table.members.length > 0 ? (
                  <ScoreBars breakdown={scoreGroup(table.members, { history, config })} />
                ) : null}
                <p className="faint">
                  {table.invitesSentAt ? 'Invite sent' : 'Invite not sent yet'}
                  {table.sequence === 1
                    ? ', updated once since.'
                    : table.sequence > 1
                      ? `, updated ${table.sequence} times since.`
                      : '.'}
                </p>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {unseated.length > 0 ? (
        <section>
          <div className="section-head">
            <h2>Could not be seated</h2>
            <p>They have been told why, once.</p>
          </div>
          <div className="card people">
            {unseated.map(({ employee, reason }) => (
              <div key={employee.id} className="row">
                <PersonRow person={employee} detail="full" />
                <Pill tone="warn">
                  {reason === 'no-common-language' ? 'no shared language' : 'too few people'}
                </Pill>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {requesters.length > 0 && tables.length === 0 ? (
        <section>
          <details className="card">
            <summary>Who asked ({requesters.length})</summary>
            <ul className="plain">
              {requesters.map((p) => (
                <li key={p.id}>
                  {p.displayName} — {p.department}
                  {requests.find((r) => r.employeeId === p.id)?.source === 'weekly' ? (
                    <span className="faint"> · every week</span>
                  ) : null}
                </li>
              ))}
            </ul>
          </details>
        </section>
      ) : null}
    </main>
  );
}

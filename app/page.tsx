import Link from 'next/link';
import { requireOnboarded } from '../src/auth/session';
import { getDb } from '../src/db';
import { calendarHints } from '../src/data/messages';
import { getPattern, intentsFor } from '../src/data/lunch';
import { getOffice, listHolidays, listOffices } from '../src/data/offices';
import { plannedDays, tablesOf, type LunchTable } from '../src/data/tables';
import type { Office } from '../src/data/types';
import { formatDay } from '../src/lib/dates';
import { addDays, formatLocalTime, isoWeekday, startOfWeek } from '../src/lib/zoned';
import { ensureFreshHints } from '../src/services/calendar';
import { WEEKDAYS } from '../src/services/forms';
import { calendarGraph } from '../src/services/runtime';
import {
  confirmInstant,
  dayPhase,
  matchInstant,
  officeToday,
  type DayPhase,
} from '../src/services/schedule';
import { savePatternAction, setDayAction } from './actions/lunch';
import { DayForm } from './DayForm';
import { Pill, PersonRow } from './ui';

export const dynamic = 'force-dynamic';

const NOTES: Record<string, { tone: 'good' | 'bad'; text: string }> = {
  saved: { tone: 'good', text: 'Saved.' },
  seated: {
    tone: 'good',
    text: 'You have a seat at a table that day. Who you are with is below.',
  },
  welcome: { tone: 'good', text: 'You are all set. Pick the days you will be in for lunch.' },
  demo: {
    tone: 'good',
    text: 'You are in, as a guest at an invented company, and already at a lunch table: open it below. Reply, pick more days, look at the console. Nothing here is real.',
  },
  pattern: { tone: 'good', text: 'Your weekly days are saved.' },
  closed: { tone: 'bad', text: 'Replies for that day have closed, so it can no longer change.' },
  off: { tone: 'bad', text: 'That office is closed that day.' },
  'no-seat': {
    tone: 'bad',
    text: 'The tables for that day were already made and none has a free seat with strangers only. Your request is kept in case the day is planned again.',
  },
  'invalid-slot': { tone: 'bad', text: 'That office does not have lunch at that time.' },
  'unknown-office': { tone: 'bad', text: 'That office is not open for lunches.' },
  'not-ready': { tone: 'bad', text: 'Finish your profile first.' },
};

interface DayView {
  date: string;
  office: Office;
  phase: DayPhase;
  holiday: string | null;
  requested: boolean;
  weekly: boolean;
  slot: string | null;
  table: LunchTable | null;
  hint: boolean;
}

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ day?: string; note?: string }>;
}) {
  const { person } = await requireOnboarded();
  const { day: highlighted, note } = await searchParams;
  const db = getDb();
  const now = new Date();

  const offices = await listOffices(db, { activeOnly: true });
  const home = person.officeId ? await getOffice(db, person.officeId) : null;
  if (!home || !home.active) {
    return (
      <main>
        <div className="page-head">
          <h1>Your lunches</h1>
        </div>
        <div className="note">
          Your office is not taking lunches at the moment. Pick another on your{' '}
          <Link href="/you">profile</Link>.
        </div>
      </main>
    );
  }

  const today = officeToday(home, now);
  // Four weeks ahead, whatever day of the week it is today.
  const span = Array.from({ length: 35 }, (_, i) => addDays(startOfWeek(today), i)).filter(
    (d) => d >= today && d < addDays(today, 28) && home.workingDays.includes(isoWeekday(d)),
  );
  const last = span[span.length - 1] ?? today;

  await ensureFreshHints(db, calendarGraph(), person, offices, { from: today, to: last });
  const [intents, tables, hints, pattern, planned] = await Promise.all([
    intentsFor(db, person, span),
    tablesOf(db, person.id, span),
    calendarHints(db, person.id, span),
    getPattern(db, person.id),
    plannedDays(
      db,
      offices.map((o) => o.id),
      span,
    ),
  ]);

  const byId = new Map(offices.map((o) => [o.id, o]));
  const holidayCache = new Map<string, Map<string, string>>();
  async function holidaysOf(office: Office): Promise<Map<string, string>> {
    if (!holidayCache.has(office.id)) {
      const list = await listHolidays(db, office.id, { from: today, to: last });
      holidayCache.set(office.id, new Map(list.map((h) => [h.date, h.name])));
    }
    return holidayCache.get(office.id)!;
  }

  const days: DayView[] = [];
  for (const date of span) {
    const intent = intents.get(date);
    const table = tables.get(date) ?? null;
    const office = byId.get(table?.officeId ?? intent?.request?.officeId ?? home.id) ?? home;
    const holidays = await holidaysOf(office);
    days.push({
      date,
      office,
      phase: dayPhase(
        office,
        date,
        new Set(holidays.keys()),
        now,
        planned.has(`${office.id} ${date}`),
      ),
      holiday: holidays.get(date) ?? null,
      requested: intent?.request != null,
      weekly: intent?.request?.source === 'weekly',
      slot: intent?.request?.slot ?? null,
      table,
      hint: hints.has(date),
    });
  }

  const flash = note ? NOTES[note] : undefined;
  // The next lunch actually happening for this person: not a cancelled table,
  // and not one they told they cannot come to.
  const upcoming = days.find(
    (d) =>
      d.table &&
      !d.table.cancelled &&
      d.table.rsvps[person.id] !== 'declined' &&
      d.phase !== 'past',
  );

  return (
    <main>
      <div className="page-head">
        <h1>Your lunches</h1>
        <p>
          Say which days you will be in {home.name} and want lunch. On the morning, before the
          office opens, you are seated with two or three people from other teams.
        </p>
      </div>

      {flash ? (
        <div className="note" data-tone={flash.tone} role="status">
          {flash.text}
        </div>
      ) : null}

      {upcoming?.table ? (
        <section>
          <article className="card highlight-card">
            <div className="spread">
              <h2>
                {upcoming.date === today ? 'Today' : formatDay(upcoming.date)},{' '}
                {upcoming.table.slot}
              </h2>
              <Link
                className="button"
                data-variant="primary"
                href={`/c/${encodeURIComponent(upcoming.table.id)}`}
              >
                Open your table
              </Link>
            </div>
            <p className="muted">
              {upcoming.office.name}
              {upcoming.office.meetingPoint ? ` — ${upcoming.office.meetingPoint}` : ''}
            </p>
            <div className="people">
              {upcoming.table.members
                .filter((m) => m.id !== person.id)
                .map((m) => (
                  <PersonRow key={m.id} person={m} rsvp={upcoming.table!.rsvps[m.id]} />
                ))}
            </div>
          </article>
        </section>
      ) : null}

      <section>
        <div className="section-head">
          <h2>The next four weeks</h2>
          <p className="faint">
            Tables for a day are made at {formatLocalTime(matchInstant(home, today), home.timeZone)}{' '}
            that morning; replies close at {home.confirmBy}.
          </p>
        </div>

        <div className="stack">
          {days.map((day) => (
            <DayRow
              key={day.date}
              day={day}
              meId={person.id}
              today={today}
              home={home}
              offices={offices}
              highlighted={day.date === highlighted}
            />
          ))}
        </div>
      </section>

      <section>
        <form action={savePatternAction} className="card stack">
          <div>
            <h2>Every week</h2>
            <p className="faint">
              Days you are always in. They are asked for automatically; untick a single week on the
              calendar above whenever you are not.
            </p>
          </div>
          <div className="checks">
            {WEEKDAYS.filter((d) => home.workingDays.includes(d.day)).map((d) => (
              <label key={d.day} className="check">
                <input
                  type="checkbox"
                  name={`day${d.day}`}
                  defaultChecked={pattern?.weekdays.includes(d.day) ?? false}
                />
                {d.long}
              </label>
            ))}
          </div>
          {home.lunchSlots.length > 1 ? (
            <label className="field" style={{ maxWidth: 240 }}>
              <span>Lunch time</span>
              <select name="slot" defaultValue={pattern?.slot ?? ''}>
                <option value="">Any time</option>
                {home.lunchSlots.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <div>
            <button type="submit">Save my weekly days</button>
          </div>
        </form>
      </section>

      <section>
        <div className="note">
          Who asked for lunch is never reported, and neither are your office days. The people at
          your table see your name, title and department, and the admins who run your office&apos;s
          lunches see the day&apos;s tables. Nobody else sees anything.
        </div>
      </section>
    </main>
  );
}

function DayRow({
  day,
  meId,
  today,
  home,
  offices,
  highlighted,
}: {
  day: DayView;
  meId: string;
  today: string;
  home: Office;
  offices: Office[];
  highlighted: boolean;
}) {
  const label = formatDay(day.date).split(' ');
  const table = day.table;
  const mine = table?.rsvps[meId];
  const canChange = day.phase === 'open' || day.phase === 'matched';
  // Times are the office's own; say whose when that is not the clock at home.
  const elsewhere = day.office.timeZone !== home.timeZone ? ` ${day.office.name} time` : '';

  return (
    <article
      className="day"
      id={day.date}
      data-attending={day.requested}
      data-highlight={highlighted}
    >
      <div className="day-date">
        {day.date === today ? 'Today' : label[0]}
        <small>{label.slice(1).join(' ')}</small>
      </div>

      <div className="day-body">
        <div className="row">
          {day.holiday !== null || day.phase === 'off' ? (
            <Pill tone="neutral">Office closed{day.holiday ? `: ${day.holiday}` : ''}</Pill>
          ) : table && !table.cancelled ? (
            mine === 'declined' ? (
              <Pill tone="bad">You are not going</Pill>
            ) : (
              <Pill tone="good">
                Table at {table.slot}
                {day.office.id !== home.id ? `, ${day.office.name}` : ''}
              </Pill>
            )
          ) : day.requested ? (
            <Pill tone="accent">
              Lunch, please{day.slot ? ` at ${day.slot}` : ''}
              {day.office.id !== home.id ? ` · ${day.office.name}` : ''}
            </Pill>
          ) : (
            <Pill tone="neutral">Not asked</Pill>
          )}
          {day.weekly && !table ? <span className="faint">every week</span> : null}
          {table?.cancelled ? <Pill tone="bad">Table cancelled</Pill> : null}
          {day.hint ? <Pill tone="neutral">Outlook: in the office</Pill> : null}
        </div>

        {table && !table.cancelled ? (
          <p className="faint" style={{ marginTop: 6 }}>
            With{' '}
            {table.members
              .filter((m) => m.id !== meId)
              .map((m) => m.displayName)
              .join(', ')}
            .
          </p>
        ) : day.requested && day.phase === 'matched' && !table ? (
          <p className="faint" style={{ marginTop: 6 }}>
            The tables are made and none had a seat for you. Too few people asked, or nobody shares
            a language with you; your languages are on your profile.
          </p>
        ) : day.requested && day.phase === 'open' ? (
          <p className="faint" style={{ marginTop: 6 }}>
            Your table arrives at{' '}
            {formatLocalTime(matchInstant(day.office, day.date), day.office.timeZone)}
            {elsewhere} that morning, here and by email. You can change your mind until then, and
            drop out until{' '}
            {formatLocalTime(confirmInstant(day.office, day.date), day.office.timeZone)}
            {elsewhere}.
          </p>
        ) : null}
      </div>

      <div className="day-actions">
        {table && !table.cancelled ? (
          <Link className="button" href={`/c/${encodeURIComponent(table.id)}`}>
            Open table
          </Link>
        ) : null}

        {canChange && day.holiday === null && (day.requested || (table && mine !== 'declined')) ? (
          <form action={setDayAction}>
            <input type="hidden" name="date" value={day.date} />
            <input type="hidden" name="want" value="no" />
            <button type="submit" data-variant="quiet">
              Not this time
            </button>
          </form>
        ) : null}

        {canChange && day.holiday === null && !day.requested && !(table && mine !== 'declined') ? (
          <DayForm
            date={day.date}
            homeId={home.id}
            offices={offices.map((o) => ({ id: o.id, name: o.name, slots: o.lunchSlots }))}
            label={day.phase === 'matched' ? 'Join a table' : "I'm in, lunch please"}
          />
        ) : null}
      </div>
    </article>
  );
}

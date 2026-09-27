import Link from 'next/link';
import { requireOnboarded } from '../../../src/auth/session';
import { getDb } from '../../../src/db';
import { getOffice, listHolidays } from '../../../src/data/offices';
import { getTable, tableOf } from '../../../src/data/tables';
import { formatDay } from '../../../src/lib/dates';
import { formatLocalTime } from '../../../src/lib/zoned';
import { inviteFor } from '../../../src/services/delivery';
import { FROM_EMAIL } from '../../../src/services/mail';
import { confirmInstant, dayPhase } from '../../../src/services/schedule';
import { respondAction } from '../../actions/lunch';
import { PersonRow, Pill } from '../../ui';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Your table · Sofra' };

const NOTES: Record<string, string> = {
  accepted: "You're coming. The table can see that.",
  declined: 'The table knows you cannot make it.',
  closed: 'This lunch has already happened.',
  'not-seated': 'You are not at this table any more.',
};

export default async function TablePage({
  params,
  searchParams,
}: {
  params: Promise<{ tableId: string }>;
  searchParams: Promise<{ note?: string }>;
}) {
  const { person } = await requireOnboarded();
  const { tableId } = await params;
  const { note } = await searchParams;
  const db = getDb();
  const table = await getTable(db, decodeURIComponent(tableId));

  // Table ids are unguessable, and still: belonging to the table is the only
  // thing that makes its roster yours. Anybody else learns nothing about it,
  // not even whether it exists.
  if (!table || !(person.id in table.rsvps)) {
    const date = table?.date;
    const mine = date ? await tableOf(db, person.id, date) : null;
    return (
      <main>
        <div className="page-head">
          <h1>Not your table</h1>
          <p>
            {mine
              ? 'Your table for that day is a different one; it may have changed after this link went out.'
              : 'This table does not exist, or you are not seated at it.'}
          </p>
        </div>
        <Link className="button" href={mine ? `/c/${encodeURIComponent(mine.id)}` : '/'}>
          {mine ? 'Open your table' : 'Back to your lunches'}
        </Link>
      </main>
    );
  }

  const office = (await getOffice(db, table.officeId))!;
  const holidays = new Set(
    (await listHolidays(db, office.id, { from: table.date, to: table.date })).map((h) => h.date),
  );
  const phase = dayPhase(office, table.date, holidays, new Date());
  const mine = table.rsvps[person.id];
  const coming = Object.values(table.rsvps).filter((s) => s === 'accepted').length;
  const out = Object.values(table.rsvps).filter((s) => s === 'declined').length;
  const invite = inviteFor(table, office, FROM_EMAIL);
  const confirmBy = formatLocalTime(confirmInstant(office, table.date), table.timeZone);

  return (
    <main>
      <div className="page-head">
        <h1>
          {formatDay(table.date)} · {table.slot}
        </h1>
        <p>
          {office.name}
          {office.meetingPoint ? ` — ${office.meetingPoint}` : ''}
        </p>
      </div>

      {note && NOTES[note] ? (
        <div className="note" role="status">
          {NOTES[note]}
        </div>
      ) : null}

      {table.cancelled ? (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="row">
            <Pill tone="bad">cancelled</Pill>
            <span className="muted">
              Too many people dropped out to keep this table. Anyone who still wanted lunch was
              offered a seat at another table first.
            </span>
          </div>
        </div>
      ) : null}

      <section>
        <article className="card">
          <div className="spread">
            <h2>Your table</h2>
            <span className="faint">
              {coming} coming · {out} out · {table.members.length - coming - out} yet to reply
            </span>
          </div>
          <div className="people">
            {table.members.map((m) => (
              <PersonRow
                key={m.id}
                person={m}
                rsvp={table.rsvps[m.id]}
                highlight={m.id === person.id}
              />
            ))}
          </div>
          <p className="faint" style={{ marginTop: 10 }}>
            {table.invitesSentAt
              ? 'The invite went to all of you at once; reply to it to agree where to go.'
              : 'The invite is on its way to all of you at once.'}
          </p>
        </article>
      </section>

      {!table.cancelled && phase !== 'past' ? (
        <section>
          <div className="section-head">
            <h2>Can you make it?</h2>
            <p>
              {phase === 'closed'
                ? 'Replies have closed, so nobody will be moved, but the table still sees yours.'
                : `Let the table know by ${confirmBy}; if it gets too small, the others are seated elsewhere.`}
            </p>
          </div>
          <div className="row">
            <form action={respondAction}>
              <input type="hidden" name="tableId" value={table.id} />
              <input type="hidden" name="status" value="accepted" />
              <button type="submit" data-variant={mine === 'accepted' ? undefined : 'primary'}>
                {mine === 'accepted' ? "You're coming" : "I'll be there"}
              </button>
            </form>
            <form action={respondAction}>
              <input type="hidden" name="tableId" value={table.id} />
              <input type="hidden" name="status" value="declined" />
              <button type="submit" data-variant="danger">
                {mine === 'declined' ? "You're out" : "Can't make it"}
              </button>
            </form>
          </div>
        </section>
      ) : null}

      <section>
        <details>
          <summary>The invite everyone received</summary>
          <div className="invite">{invite.text}</div>
        </details>
      </section>
    </main>
  );
}

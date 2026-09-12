import Link from 'next/link';
import { getStore } from '../../../src/store/instance';
import { formatDay } from '../../../src/lib/dates';
import { toVenue } from '../../../src/lib/venue';
import { buildInvite } from '../../../src/notify/invite';
import { respondToInvite } from '../../actions';
import { PersonRow, Pill } from '../../ui';

export default async function ConfirmPage({ params }: { params: Promise<{ groupId: string }> }) {
  const store = getStore();
  const { groupId } = await params;
  const group = store.getGroup(decodeURIComponent(groupId));

  if (!group) {
    return (
      <main>
        <div className="page-head">
          <h1>This table no longer exists</h1>
          <p>It may have been re-matched. Your latest invite is always on your lunches page.</p>
        </div>
        <Link className="button" href="/">
          Back to your lunches
        </Link>
      </main>
    );
  }

  const office = store.getOffice(group.officeId)!;
  const meId = store.getCurrentEmployeeId();
  const me = group.members.find((m) => m.id === meId);
  const myStatus = me ? group.rsvps[me.id] : undefined;

  // Someone who was moved off this table still has the old link in their inbox.
  const movedTo = me ? null : store.groupForEmployee(meId, group.date, group.officeId);

  const invite = buildInvite({
    group,
    venue: toVenue(office),
    organizer: { name: 'Sofra', email: 'sofra@example.com' },
    sequence: group.sequence,
  });

  const coming = Object.values(group.rsvps).filter((s) => s === 'accepted').length;
  const declined = Object.values(group.rsvps).filter((s) => s === 'declined').length;

  return (
    <main>
      <div className="page-head">
        <h1>
          {formatDay(group.date)} · {group.slot}
        </h1>
        <p>
          {office.displayName} — {office.meetingPoint}
        </p>
      </div>

      {group.cancelled ? (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="row">
            <Pill tone="bad">cancelled</Pill>
            <span className="muted">
              Too many people dropped out to keep this table worth having. Anyone who still wanted
              lunch has been moved to another table — nobody will turn up to an empty room.
            </span>
          </div>
        </div>
      ) : null}

      {movedTo ? (
        <div className="note" style={{ marginBottom: 16 }}>
          This table changed and you were moved.{' '}
          <Link href={`/c/${encodeURIComponent(movedTo.id)}`}>Open your table</Link>.
        </div>
      ) : null}

      <section>
        <article className="card">
          <div className="spread">
            <h2>Your table</h2>
            <span className="faint">
              {coming} coming · {declined} out · {group.members.length - coming - declined} yet to
              reply
            </span>
          </div>

          <div className="people">
            {group.members.map((person) => (
              <PersonRow
                key={person.id}
                person={person}
                rsvp={group.rsvps[person.id]}
                highlight={person.id === meId}
              />
            ))}
          </div>

          <p className="faint" style={{ marginTop: 10 }}>
            Sort out where to go between yourselves — reply to the invite mail, it went to all of
            you.
          </p>
        </article>
      </section>

      {me && !group.cancelled ? (
        <section>
          <div className="section-head">
            <h2>Can you make it?</h2>
            <p>Let us know by 10:00 so the table can be reseated.</p>
          </div>
          <div className="row">
            <form action={respondToInvite}>
              <input type="hidden" name="groupId" value={group.id} />
              <input type="hidden" name="employeeId" value={me.id} />
              <input type="hidden" name="status" value="accepted" />
              <button type="submit" data-variant={myStatus === 'accepted' ? undefined : 'primary'}>
                {myStatus === 'accepted' ? "You're coming" : "I'll be there"}
              </button>
            </form>
            <form action={respondToInvite}>
              <input type="hidden" name="groupId" value={group.id} />
              <input type="hidden" name="employeeId" value={me.id} />
              <input type="hidden" name="status" value="declined" />
              <button type="submit" data-variant="danger">
                {myStatus === 'declined' ? "You're out" : "Can't make it"}
              </button>
            </form>
          </div>
        </section>
      ) : null}

      {!me && !movedTo ? (
        <section>
          <p className="faint">
            You are not at this table. Switch account in the header to respond as someone who is.
          </p>
        </section>
      ) : null}

      <section>
        <details open>
          <summary>The invite everyone received</summary>
          <div className="invite">{invite.text}</div>
        </details>
      </section>
    </main>
  );
}

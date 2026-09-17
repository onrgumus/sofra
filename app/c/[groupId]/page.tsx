import Link from 'next/link';
import { getStore } from '../../../src/store/instance';
import { currentEmployeeId } from '../../../src/lib/session';
import { redirect } from 'next/navigation';
import { formatDay } from '../../../src/lib/dates';
import { toVenue } from '../../../src/lib/venue';
import { buildInvite } from '../../../src/notify/invite';
import type { StoredGroup } from '../../../src/store/types';
import { respondToInvite } from '../../actions';
import { PersonRow, Pill } from '../../ui';

export default async function ConfirmPage({ params }: { params: Promise<{ groupId: string }> }) {
  const store = getStore();
  const { groupId } = await params;
  const group = await store.getGroup(decodeURIComponent(groupId));

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

  const office = (await store.getOffice(group.officeId))!;
  const meId = await currentEmployeeId(store);
  if (!meId) redirect('/login');
  const me = group.members.find((m) => m.id === meId);
  const myStatus = me ? group.rsvps[me.id] : undefined;

  // Someone who was moved off this table still has the old link in their inbox.
  const movedTo = me ? null : await store.groupForEmployee(meId, group.date, group.officeId);

  // Group ids are guessable, so without this any signed-in employee could walk
  // -1 to -8 and read every table in the building. That is precisely the list
  // of who ticked the box, which the employee page promises nobody can see.
  // Belonging to the table is the only thing that makes its roster yours.
  if (!me) return <NotYourTable movedTo={movedTo} date={group.date} />;

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
              lunch has been moved to another table, so nobody will turn up to an empty room.
            </span>
          </div>
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
                highlight={person.id === me.id}
              />
            ))}
          </div>

          <p className="faint" style={{ marginTop: 10 }}>
            {/* Whether the mail exists yet, rather than assuming. Matching and
                sending are separate steps, and between them this told people to
                reply to something nobody had received. */}
            {group.invitesSentAt
              ? 'Sort out where to go between yourselves by replying to the invite mail, which went to all of you.'
              : 'The invite has not gone out yet. When it does it reaches all of you at once, and you can sort out where to go by replying to it.'}
          </p>
        </article>
      </section>

      {!group.cancelled ? (
        <section>
          <div className="section-head">
            <h2>Can you make it?</h2>
            <p>Let us know by 10:00 so the table can be reseated.</p>
          </div>
          <div className="row">
            <form action={respondToInvite}>
              <input type="hidden" name="groupId" value={group.id} />
              <input type="hidden" name="status" value="accepted" />
              <button type="submit" data-variant={myStatus === 'accepted' ? undefined : 'primary'}>
                {myStatus === 'accepted' ? "You're coming" : "I'll be there"}
              </button>
            </form>
            <form action={respondToInvite}>
              <input type="hidden" name="groupId" value={group.id} />
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
          <summary>
            {group.invitesSentAt ? 'The invite everyone received' : 'The invite that will go out'}
          </summary>
          <div className="invite">{invite.text}</div>
        </details>
      </section>
    </main>
  );
}

/**
 * What someone sees when the link is not theirs.
 *
 * Says nothing about who is at that table, including whether it exists as
 * anything more than a guessed id: an employee who walks the ids learns only
 * that they are not at any of them, which they already knew.
 */
function NotYourTable({ movedTo, date }: { movedTo: StoredGroup | null; date: string }) {
  return (
    <main>
      <div className="page-head">
        <h1>Not your table</h1>
        <p>
          {/* Not "you were moved": being on another table is not evidence of
              having been on this one. Somebody who simply opened a link that
              was not theirs was told a story about themselves. */}
          {movedTo
            ? `This is not your table. Yours for ${formatDay(date)} is a different one, which may be because this one changed after the invite went out.`
            : `You are not seated at this table on ${formatDay(date)}.`}
        </p>
      </div>
      <Link className="button" href={movedTo ? `/c/${encodeURIComponent(movedTo.id)}` : '/'}>
        {movedTo ? 'Open your table' : 'Back to your lunches'}
      </Link>
    </main>
  );
}

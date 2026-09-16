import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getStore } from '../../src/store/instance';
import { currentEmployeeId } from '../../src/lib/session';
import { formatDay, todayInZone, upcomingWeekdays } from '../../src/lib/dates';
import { teamName } from '../ui';

// Reads mutable store state on every request, so it must never be prerendered.
export const dynamic = 'force-dynamic';

export const metadata = { title: 'What Sofra knows · Sofra' };

/**
 * Everything the product holds about one person, in one place.
 *
 * Partly a product gap: people were asked to trust a thing that seats them with
 * strangers and given no way to see what it had on them or which address the
 * invite was going to. Partly the transparency docs/privacy.md promises, which
 * is cheap to honour when the answer is this short, and much more convincing
 * than a policy page saying the same thing in the abstract.
 */
export default async function ProfilePage() {
  const store = getStore();
  const employeeId = await currentEmployeeId(store);
  if (!employeeId) redirect('/login');

  const me = await store.getEmployee(employeeId);
  const office = me ? await store.getOffice(me.officeId) : undefined;
  if (!me || !office) redirect('/login');

  const days = upcomingWeekdays(10, todayInZone(office.timeZone));
  const asked = (
    await Promise.all(
      days.map(async (date) => ((await store.getOptIn(me.id, date, office.id)) ? date : null)),
    )
  ).filter((date): date is string => date !== null);

  const past = (await store.listPastMatches()).filter((match) => match.memberIds.includes(me.id));

  return (
    <main>
      <div className="page-head">
        <h1>What Sofra knows about you</h1>
        <p>All of it. If something here is wrong, it is wrong in your company directory.</p>
      </div>

      <section>
        <div className="section-head">
          <h2>You</h2>
        </div>
        <dl className="facts">
          <Fact label="Name" value={me.displayName} />
          <Fact label="Role" value={`${me.title}, ${me.department}`} />
          <Fact label="Team" value={teamName(me.team)} />
          <Fact label="Office" value={office.displayName} />
          <Fact label="Time here" value={`${me.tenureMonths} months`} />
          <Fact label="Languages" value={me.languages.join(', ')} />
          <Fact
            label="Interests"
            value={me.interests.length > 0 ? me.interests.join(', ') : 'none given'}
          />
        </dl>
      </section>

      <section>
        <div className="section-head">
          <h2>Where your invites go</h2>
        </div>
        <dl className="facts">
          <Fact label="Email" value={me.email} />
        </dl>
        <p className="faint" style={{ marginTop: 8 }}>
          One mail per lunch, to the whole table at once. Nothing else is ever sent here.
        </p>
      </section>

      <section>
        <div className="section-head">
          <h2>Days you have asked for a lunch</h2>
        </div>
        {asked.length === 0 ? (
          <p className="faint">
            None in the next two weeks. <Link href="/">Your lunches</Link> is where you tick one.
          </p>
        ) : (
          <ul className="plain">
            {asked.map((date) => (
              <li key={date}>{formatDay(date)}</li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <div className="section-head">
          <h2>Lunches you have been seated at</h2>
          <p>Kept only so you are not matched with the same people again too soon.</p>
        </div>
        {past.length === 0 ? (
          <p className="faint">None yet.</p>
        ) : (
          <ul className="plain">
            {past
              .slice()
              .sort((a, b) => b.date.localeCompare(a.date))
              .slice(0, 10)
              .map((match) => (
                <li key={`${match.date}-${match.memberIds.join()}`}>
                  {formatDay(match.date)}, with {match.memberIds.length - 1} others
                </li>
              ))}
          </ul>
        )}
      </section>

      <section>
        <div className="note">
          Not held: your gender, your age, what you eat, where you sit, what is in your calendar
          beyond whether you are in the building, or any record of who you chose not to have lunch
          with. Your office days come from the desk-booking system and are not reported anywhere by
          Sofra.
        </div>
      </section>
    </main>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </>
  );
}

import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getStore } from '../../src/store/instance';
import { currentEmployeeId } from '../../src/lib/session';
import { formatDay, todayInZone, upcomingWeekdays } from '../../src/lib/dates';
import { setReminders, updateProfile } from '../actions';
import { MAX_INTERESTS } from '../../src/core/profile';
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
  const profile = await store.getProfile(me.id);

  // Offer the languages this company actually has, so the list is never a
  // theoretical set of codes nobody here speaks.
  const languagesInUse = [
    ...new Set((await store.listEmployees()).flatMap((e) => e.languages)),
  ].sort();
  const remindersOn = !(await store.listRemindersOff()).includes(me.id);

  return (
    <main>
      <div className="page-head">
        <h1>What Sofra knows about you</h1>
        <p>
          All of it. Two things are yours to change, because your company directory does not hold
          them; the rest comes from the directory and is wrong there if it is wrong here.
        </p>
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
        </dl>
        <p className="faint" style={{ marginTop: 8 }}>
          From your company directory. Sofra cannot change any of it, deliberately: being able to
          edit your own department here would be a way to choose who you get seated with.
        </p>
      </section>

      <section>
        <div className="section-head">
          <h2>What you tell us yourself</h2>
          <p>
            The only two things here your company directory does not hold, and the two that decide
            who you sit with. A table needs a language everyone at it speaks, and the invite opens
            with something you have in common.
          </p>
        </div>

        <form action={updateProfile} className="stack">
          <div className="field">
            <span className="field-label">Languages you are happy having lunch in</span>
            <div className="row" style={{ flexWrap: 'wrap' }}>
              {languagesInUse.map((code) => (
                <label className="check" key={code}>
                  <input
                    type="checkbox"
                    name="languages"
                    value={code}
                    defaultChecked={me.languages.includes(code)}
                  />
                  {LANGUAGE_NAMES[code] ?? code}
                </label>
              ))}
            </div>
            <span className="faint">
              Pick at least one. This is a hard rule in the matching, not a preference: you will
              never be seated at a table with no language in common.
            </span>
          </div>

          <div className="field">
            <label className="field-label" htmlFor="interests">
              Interests
            </label>
            <input
              id="interests"
              name="interests"
              type="text"
              defaultValue={(profile?.interests ?? me.interests).join(', ')}
              placeholder="running, chess, live music"
            />
            <span className="faint">
              Separated by commas, up to {MAX_INTERESTS}. Used to find an opener for your table.
              Leave it empty and the invite falls back to what your jobs have in common.
            </span>
          </div>

          <div className="row">
            <button type="submit" data-variant="primary">
              Save
            </button>
            {profile ? (
              <span className="faint">
                Last changed {formatDay(profile.updatedAt.slice(0, 10))}
              </span>
            ) : (
              <span className="faint">Never changed, so these came from the directory.</span>
            )}
          </div>
        </form>
      </section>

      <section>
        <div className="section-head">
          <h2>Where your invites go</h2>
        </div>
        <dl className="facts">
          <Fact label="Email" value={me.email} />
        </dl>
        <p className="faint" style={{ marginTop: 8 }}>
          This is the address your company directory has for you, and it is the one Sofra can prove
          belongs to you. If it is wrong, ask whoever runs your directory to correct it: changing it
          here would let anyone redirect a colleague&apos;s invites, and the next sync would undo it
          anyway.
        </p>
        <p className="faint" style={{ marginTop: 8 }}>
          One mail per lunch, to the whole table at once, and at most one short question on a day
          you are already coming in. Nothing else is ever sent here.
        </p>
      </section>

      <section>
        <div className="section-head">
          <h2>Being asked</h2>
          <p>
            On days your desk booking says you will be in, Sofra asks once whether you want lunch
            with people from other teams. Turn it off and you will only hear from Sofra when you
            have ticked a day yourself.
          </p>
        </div>
        <form action={setReminders} className="inline">
          <input type="hidden" name="enabled" value={remindersOn ? 'false' : 'true'} />
          <span>{remindersOn ? 'Reminders are on.' : 'Reminders are off.'}</span>
          <button type="submit" data-variant={remindersOn ? 'quiet' : 'primary'}>
            {remindersOn ? 'Turn them off' : 'Turn them on'}
          </button>
        </form>
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

/** Only for the codes a company turns out to use; anything else shows as-is. */
const LANGUAGE_NAMES: Record<string, string> = {
  en: 'English',
  tr: 'Türkçe',
  nl: 'Nederlands',
  de: 'Deutsch',
  fr: 'Français',
  es: 'Español',
  it: 'Italiano',
  pt: 'Português',
  pl: 'Polski',
  ar: 'العربية',
};

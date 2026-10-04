import { requireOnboarded } from '../../src/auth/session';
import { getDb } from '../../src/db';
import { listSessionsOf } from '../../src/data/sessions';
import { signOutAction, signOutElsewhereAction } from '../actions/auth';
import { ProfileForm } from '../ProfileForm';
import { profileFormProps } from '../profile-props';
import { teamsOnly } from '../../src/lib/teams-mode';
import { describeDevice } from '../../src/lib/device';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Profile · Sofra' };

function when(iso: string): string {
  return new Date(iso).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

const METHOD: Record<string, string> = {
  email: 'Email link',
  oidc: 'Company sign-in',
  teams: 'Teams',
  demo: 'Demo guest',
};

/** What Sofra holds about you, all of it editable here, and where you are signed in. */
export default async function YouPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; signedOut?: string; guest?: string }>;
}) {
  const { person, session } = await requireOnboarded();
  const { saved, signedOut, guest } = await searchParams;
  const db = getDb();
  const sessions = await listSessionsOf(db, person.id);

  return (
    <main>
      <div className="page-head">
        <h1>Your profile</h1>
        <p>
          This is everything Sofra knows about you, and it is used for one thing: seating you with
          people from other departments and levels, who share a language with you. Signed in as{' '}
          <strong>{person.email}</strong>.
        </p>
      </div>

      {saved ? (
        <div className="note" data-tone="good" role="status">
          Saved.
        </div>
      ) : null}
      {guest || session.method === 'demo' ? (
        <div className="note" role="note">
          You are a guest in the public demo, with an invented colleague&apos;s profile. It is shown
          here as anybody&apos;s would be, and cannot be changed.
        </div>
      ) : null}
      {signedOut ? (
        <div className="note" data-tone="good" role="status">
          Every other device is signed out.
        </div>
      ) : null}

      <section>
        <ProfileForm {...await profileFormProps(db, person, 'Save')} />
      </section>

      <section>
        <div className="section-head">
          <h2>Where you are signed in</h2>
        </div>
        <div className="card">
          <table className="data">
            <thead>
              <tr>
                <th>How</th>
                <th>Device</th>
                <th>Last used</th>
                <th>Expires</th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((s) => (
                <tr key={s.idHash}>
                  <td>
                    {METHOD[s.method] ?? s.method}
                    {s.idHash === session.idHash ? (
                      <span className="faint"> · this one</span>
                    ) : null}
                  </td>
                  <td title={s.userAgent}>{describeDevice(s.userAgent)}</td>
                  <td>{when(s.lastSeenAt)}</td>
                  <td>{when(s.expiresAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="row" style={{ marginTop: 12 }}>
            {sessions.length > 1 ? (
              <form action={signOutElsewhereAction}>
                <button type="submit">Sign out everywhere else</button>
              </form>
            ) : null}
            {teamsOnly() ? null : (
              <form action={signOutAction}>
                <button type="submit" data-variant="quiet">
                  Sign out
                </button>
              </form>
            )}
          </div>
        </div>
      </section>
    </main>
  );
}

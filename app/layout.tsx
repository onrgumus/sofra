import './globals.css';
import Link from 'next/link';
import { adminRole, current } from '../src/auth/session';
import { embeddedInTeams, teamsOnly } from '../src/lib/teams-mode';
import { signOutAction } from './actions/auth';
import { TeamsTheme } from './TeamsTheme';

export const metadata = {
  title: 'Sofra',
  description: 'Lunch with colleagues you would never otherwise meet.',
};

// Reads the session and the database on every request.
export const dynamic = 'force-dynamic';

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const me = await current();
  const role = me ? await adminRole() : null;
  const onboarded = me?.person.onboardedAt != null;

  return (
    <html lang="en">
      <body>
        {embeddedInTeams() ? <TeamsTheme /> : null}
        {me ? (
          <header className="topbar">
            <div className="topbar-inner">
              <Link href="/" className="wordmark">
                <span aria-hidden="true">◍</span> Sofra
              </Link>

              <span className="who">
                <strong>{me.person.displayName || me.person.email}</strong>
                {me.person.title ? <span className="who-role">{me.person.title}</span> : null}
              </span>

              <nav className="nav" aria-label="Main">
                {onboarded ? <Link href="/">Your lunches</Link> : null}
                {onboarded ? <Link href="/you">Profile</Link> : null}
                {role ? <Link href="/admin">Console</Link> : null}
                {/* Teams owns the identity inside Teams: signing out of the tab
                    would only be signed straight back in. */}
                {teamsOnly() ? null : (
                  <form action={signOutAction}>
                    <button type="submit" data-variant="quiet">
                      Sign out
                    </button>
                  </form>
                )}
              </nav>
            </div>
          </header>
        ) : null}
        <div className="shell">{children}</div>
      </body>
    </html>
  );
}

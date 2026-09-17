import './globals.css';
import Link from 'next/link';
import { getStore } from '../src/store/instance';
import { currentEmployeeId } from '../src/lib/session';
import { signOut, switchEmployee } from './actions';
import { demoModeEnabled, isAdmin } from '../src/lib/authz';
import { AutoSubmitSelect } from './AutoSubmit';

export const metadata = {
  title: 'Sofra',
  description: 'Lunch with people you would never otherwise meet.',
};

// Reads mutable store state on every request, so it must never be prerendered.
export const dynamic = 'force-dynamic';

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const store = getStore();
  const currentId = await currentEmployeeId(store);

  // Signed out: the sign-in page is the only thing that renders, and a header
  // full of colleagues would be an odd thing to show someone who is not in yet.
  if (!currentId) {
    return (
      <html lang="en">
        <body>
          <div className="shell">{children}</div>
        </body>
      </html>
    );
  }

  const current = await store.getEmployee(currentId);
  const viewerIsAdmin = await isAdmin(store, current);

  // Only when the switcher is actually going to be drawn. This ran on every
  // page, loading and sorting a whole office, for a control that a real
  // deployment never renders.
  const demo = demoModeEnabled();
  const colleagues = demo
    ? (await store.listEmployees(current?.officeId))
        .slice()
        .sort((a, b) => a.displayName.localeCompare(b.displayName))
    : [];

  return (
    <html lang="en">
      <body>
        <header className="topbar">
          <div className="topbar-inner">
            <Link href="/" className="wordmark">
              <span>◍</span> Sofra
            </Link>

            <span className="who">
              <strong>{current?.displayName}</strong>
              {current ? <span className="who-role">{current.title}</span> : null}
            </span>

            <nav className="nav">
              <Link href="/">Your lunches</Link>
              <Link href="/you">Your details</Link>
              {viewerIsAdmin ? <Link href="/admin">Admin</Link> : null}
              {viewerIsAdmin ? <Link href="/admin/people">Admins</Link> : null}
              <form action={signOut}>
                <button type="submit" data-variant="quiet">
                  Sign out
                </button>
              </form>
            </nav>
          </div>
        </header>

        {/*
          The account switcher is impersonation, and it belongs to the demo
          rather than to the product. Kept out of the header and labelled,
          because sitting in the chrome it read as a feature: an end user has no
          business being shown a list of everyone in the building, which is the
          one thing the rest of the app refuses to do.
        */}
        {demo ? (
          <div className="demo-bar">
            <span className="demo-tag">Demo</span>
            <form action={switchEmployee} className="inline">
              <label className="sr-only" htmlFor="become">
                Try the app as a different colleague
              </label>
              <AutoSubmitSelect
                name="employeeId"
                defaultValue={currentId}
                aria-label="Try the app as a different colleague"
                options={colleagues.map((e) => ({ value: e.id, label: e.displayName }))}
              />
            </form>
            <span className="faint">
              Try it as someone else. Signed in properly, you would only ever see yourself.
            </span>
          </div>
        ) : null}

        <div className="shell">{children}</div>
      </body>
    </html>
  );
}

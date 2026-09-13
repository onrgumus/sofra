import './globals.css';
import Link from 'next/link';
import { getStore } from '../src/store/instance';
import { currentEmployeeId } from '../src/lib/session';
import { signOut, switchEmployee } from './actions';
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

  // Signed out — the sign-in page is the only thing that renders, and a header
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
  const colleagues = (await store.listEmployees(current?.officeId))
    .slice()
    .sort((a, b) => a.displayName.localeCompare(b.displayName));

  return (
    <html lang="en">
      <body>
        <header className="topbar">
          <div className="topbar-inner">
            <Link href="/" className="wordmark">
              <span>◍</span> Sofra
            </Link>

            {/* No auth in the demo, so "who am I" is a switcher. */}
            {/* Names only: a select showing "Name — Long Title, Department" is
                wider than any sensible header and just truncates. The role goes
                next to it, where it can wrap. */}
            <form action={switchEmployee} className="inline who">
              <AutoSubmitSelect
                name="employeeId"
                defaultValue={currentId}
                aria-label="Signed in as"
                options={colleagues.map((e) => ({ value: e.id, label: e.displayName }))}
              />
              {current ? <span className="who-role">{current.title}</span> : null}
            </form>

            <nav className="nav">
              <Link href="/">Your lunches</Link>
              <Link href="/admin">Admin</Link>
              <form action={signOut}>
                <button type="submit" data-variant="quiet">
                  Sign out
                </button>
              </form>
            </nav>
          </div>
        </header>
        <div className="shell">{children}</div>
      </body>
    </html>
  );
}

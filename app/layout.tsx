import './globals.css';
import Link from 'next/link';
import { getStore } from '../src/store/instance';
import { currentEmployeeId } from '../src/lib/session';
import { switchEmployee } from './actions';
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
  const current = store.getEmployee(currentId);
  const colleagues = store
    .listEmployees(current?.officeId)
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
            <form action={switchEmployee} className="inline">
              <AutoSubmitSelect
                name="employeeId"
                defaultValue={currentId}
                aria-label="Signed in as"
                options={colleagues.map((e) => ({
                  value: e.id,
                  label: `${e.displayName} — ${e.title}, ${e.department}`,
                }))}
              />
            </form>

            <nav className="nav">
              <Link href="/">Your lunches</Link>
              <Link href="/admin">Admin</Link>
            </nav>
          </div>
        </header>
        <div className="shell">{children}</div>
      </body>
    </html>
  );
}

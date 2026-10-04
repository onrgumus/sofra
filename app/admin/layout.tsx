import Link from 'next/link';
import { requireAdmin } from '../../src/auth/session';

export const dynamic = 'force-dynamic';

/**
 * Every console page sits behind this: an admin, signed in recently. The
 * pages and their actions check again, for their own office, because a layout
 * guards what is rendered and not what can be posted.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const { role } = await requireAdmin();

  return (
    <div>
      <nav className="subnav" aria-label="Console">
        <Link href="/admin">Day</Link>
        <Link href="/admin/offices">Offices</Link>
        {role.everyOffice ? <Link href="/admin/people">People</Link> : null}
        {role.everyOffice ? <Link href="/admin/settings">Settings</Link> : null}
        <Link href="/admin/runs">Runs</Link>
        {role.everyOffice ? <Link href="/admin/audit">Audit log</Link> : null}
      </nav>
      {role.readOnly ? (
        <div className="note" role="note" style={{ marginBottom: 16 }}>
          You are a guest in a public demo. This is the console as an admin sees it; nothing in it
          can be changed from here.
        </div>
      ) : null}
      {children}
    </div>
  );
}

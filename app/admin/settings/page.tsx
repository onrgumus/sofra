import { requireAdmin } from '../../../src/auth/session';
import { bootstrapDomains } from '../../../src/auth/signin';
import { getDb } from '../../../src/db';
import { getSetting, listAllowedDomains, listDepartments } from '../../../src/data/settings';
import {
  addDepartmentAction,
  addDomainAction,
  removeDepartmentAction,
  removeDomainAction,
  renameDepartmentAction,
  setCompanyNameAction,
} from '../../actions/admin';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Settings · Sofra' };

const ERRORS: Record<string, string> = {
  domain: 'That is not a domain, like acme.com.',
  department: 'A department needs a name.',
  rename: 'A department with that name already exists.',
  inuse: 'Somebody is still in that department. Move them first, or rename it instead.',
};

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; saved?: string }>;
}) {
  await requireAdmin({ everyOffice: true });
  const { error, saved } = await searchParams;
  const db = getDb();
  const [domains, departments, companyName] = await Promise.all([
    listAllowedDomains(db),
    listDepartments(db),
    getSetting(db, 'company_name', ''),
  ]);
  const fromEnv = bootstrapDomains();

  return (
    <main>
      <div className="page-head">
        <h1>Settings</h1>
        <p>For the whole company. Every change is recorded in the audit log.</p>
      </div>
      {error && ERRORS[error] ? (
        <p className="error-text" role="alert">
          {ERRORS[error]}
        </p>
      ) : null}
      {saved ? (
        <div className="note" data-tone="good" role="status">
          Saved.
        </div>
      ) : null}

      <section>
        <div className="section-head">
          <h2>Company name</h2>
          <p>Shown in sign-in mail.</p>
        </div>
        <form action={setCompanyNameAction} className="card inline">
          <input
            name="companyName"
            defaultValue={companyName}
            placeholder="Acme"
            aria-label="Company name"
          />
          <button type="submit">Save</button>
        </form>
      </section>

      <section>
        <div className="section-head">
          <h2>Who can sign in by email</h2>
          <p>
            Anybody with a mailbox at one of these domains can sign in and set up a profile. Exact
            domains only: a subdomain is a different mail system.
          </p>
        </div>
        <div className="card stack">
          <ul className="plain">
            {fromEnv.map((d) => (
              <li key={`env-${d}`}>
                <span className="mono">{d}</span>{' '}
                <span className="faint">(SOFRA_ALLOWED_DOMAINS)</span>
              </li>
            ))}
            {domains.map((d) => (
              <li key={d} className="row spread">
                <span className="mono">{d}</span>
                <form action={removeDomainAction}>
                  <input type="hidden" name="domain" value={d} />
                  <button type="submit" data-variant="quiet">
                    Remove
                  </button>
                </form>
              </li>
            ))}
          </ul>
          <form action={addDomainAction} className="inline">
            <input name="domain" placeholder="acme.com" aria-label="Domain" required />
            <button type="submit">Allow domain</button>
          </form>
        </div>
      </section>

      <section>
        <div className="section-head">
          <h2>Departments</h2>
          <p>
            People pick theirs from this list. Tables mix departments, so the names have to agree.
          </p>
        </div>
        <div className="card stack">
          <ul className="plain">
            {departments.map((d) => (
              <li key={d} className="row spread">
                <form action={renameDepartmentAction} className="inline">
                  <input type="hidden" name="from" value={d} />
                  <input name="to" defaultValue={d} aria-label={`Rename ${d}`} />
                  <button type="submit" data-variant="quiet">
                    Rename
                  </button>
                </form>
                <form action={removeDepartmentAction}>
                  <input type="hidden" name="name" value={d} />
                  <button type="submit" data-variant="quiet">
                    Remove
                  </button>
                </form>
              </li>
            ))}
          </ul>
          <form action={addDepartmentAction} className="inline">
            <input name="name" placeholder="Finance" aria-label="Department" required />
            <button type="submit">Add department</button>
          </form>
        </div>
      </section>
    </main>
  );
}

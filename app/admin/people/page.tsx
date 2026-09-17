import Link from 'next/link';
import { getStore } from '../../../src/store/instance';
import { currentEmployeeId } from '../../../src/lib/session';
import { bootstrapAdmins, isAdmin, isBootstrapAdmin } from '../../../src/lib/authz';
import { formatDay } from '../../../src/lib/dates';
import { grantAdmin, revokeAdmin } from '../../actions';
import { Initials, Pill } from '../../ui';

/** Enough to pick somebody from, few enough that picking the wrong one is hard. */
const MAX_RESULTS = 8;

// Reads who currently holds the console, which changes while the app runs.
export const dynamic = 'force-dynamic';

export const metadata = { title: 'Who has the console · Sofra' };

/**
 * Granting and removing the console, from inside the application.
 *
 * Administration that needs a deployment is not administration. SOFRA_ADMINS
 * stays as the bootstrap and is deliberately not editable here: it is the way
 * back in if the granted list ends up empty, and a list that can delete itself
 * is not a way back.
 */
export default async function AdminPeoplePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const store = getStore();
  const viewerId = await currentEmployeeId(store);
  const viewer = viewerId ? await store.getEmployee(viewerId) : undefined;

  if (!viewer || !(await isAdmin(store, viewer))) {
    return (
      <main>
        <div className="page-head">
          <h1>Not your console</h1>
          <p>Only named people can see or change who administers Sofra.</p>
        </div>
        <Link className="button" href="/">
          Back to your lunches
        </Link>
      </main>
    );
  }

  const grants = await store.listAdmins();
  const employees = await store.listEmployees();
  const byId = new Map(employees.map((e) => [e.id, e]));

  const grantedIds = new Set(grants.map((g) => g.employeeId));
  const fromEnvironment = employees.filter((e) => isBootstrapAdmin(e));
  // Searched rather than listed. A company of any size makes a dropdown of
  // everybody unusable, and this page exists to be used rarely and carefully.
  const query = (q ?? '').trim().toLowerCase();
  const eligible = employees.filter((e) => !grantedIds.has(e.id) && !isBootstrapAdmin(e));
  const matches =
    query.length < 2
      ? []
      : eligible
          .filter((e) =>
            [e.displayName, e.email, e.department, e.title].some((field) =>
              field.toLowerCase().includes(query),
            ),
          )
          .sort((a, b) => a.displayName.localeCompare(b.displayName));

  return (
    <main>
      <div className="page-head">
        <h1>Who has the console</h1>
        <p>
          The console shows every table and every reply for a whole office, and its buttons re-plan
          the day and mail everyone in it. Keep this list short.
        </p>
      </div>

      <section>
        <div className="section-head">
          <h2>Granted in the app</h2>
          <p>Takes effect on their next page load. No deployment.</p>
        </div>

        {grants.length === 0 ? (
          <div className="empty">
            Nobody yet. Everyone with the console is here from the environment.
          </div>
        ) : (
          <div className="stack">
            {grants.map((grant) => {
              const person = byId.get(grant.employeeId);
              return (
                <div className="card" key={grant.employeeId}>
                  <div className="spread">
                    <div className="person">
                      <Initials name={person?.displayName ?? grant.employeeId} />
                      <div className="person-body">
                        <div className="person-name">{person?.displayName ?? grant.employeeId}</div>
                        <div className="person-meta">
                          {person
                            ? `${person.title}, ${person.department}`
                            : 'no longer in the directory'}
                        </div>
                      </div>
                    </div>

                    <div className="row">
                      <span className="faint">
                        granted by {byId.get(grant.grantedBy)?.displayName ?? grant.grantedBy} on{' '}
                        {formatDay(grant.grantedAt.slice(0, 10))}
                      </span>
                      {grant.employeeId === viewer.id ? (
                        <Pill tone="neutral">you</Pill>
                      ) : (
                        <form action={revokeAdmin}>
                          <input type="hidden" name="employeeId" value={grant.employeeId} />
                          <button type="submit" data-variant="danger">
                            Remove
                          </button>
                        </form>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section>
        <div className="section-head">
          <h2>Give someone the console</h2>
          <p>They will be able to grant it to others as well.</p>
        </div>

        <form method="get" action="/admin/people" className="inline">
          <label className="sr-only" htmlFor="q">
            Search your colleagues by name, address, role or department
          </label>
          <input
            id="q"
            name="q"
            type="search"
            defaultValue={q ?? ''}
            placeholder="Name, address, role or department"
            autoComplete="off"
          />
          <button type="submit">Search</button>
        </form>

        {eligible.length === 0 ? (
          <div className="empty">Everyone in the directory already has it.</div>
        ) : query.length < 2 ? (
          <p className="faint">
            {employees.length} people in the directory. Type at least two characters.
          </p>
        ) : matches.length === 0 ? (
          <div className="empty">Nobody matches “{q}”.</div>
        ) : (
          <div className="stack">
            {matches.slice(0, MAX_RESULTS).map((person) => (
              <div className="card" key={person.id}>
                <div className="spread">
                  <div className="person">
                    <Initials name={person.displayName} />
                    <div className="person-body">
                      <div className="person-name">{person.displayName}</div>
                      <div className="person-meta">
                        {person.title}, {person.department} · {person.email}
                      </div>
                    </div>
                  </div>
                  <form action={grantAdmin}>
                    <input type="hidden" name="employeeId" value={person.id} />
                    <button type="submit" data-variant="primary">
                      Grant
                    </button>
                  </form>
                </div>
              </div>
            ))}
            {matches.length > MAX_RESULTS ? (
              <p className="faint">
                {matches.length - MAX_RESULTS} more match. Narrow the search rather than scrolling.
              </p>
            ) : null}
          </div>
        )}
      </section>

      <section>
        <div className="section-head">
          <h2>From the environment</h2>
          <p>
            Set with SOFRA_ADMINS and not removable here, on purpose: this is how the first person
            gets in, and how anyone gets back in if the list above ends up empty by mistake.
          </p>
        </div>

        {fromEnvironment.length === 0 ? (
          <div className="empty">
            {bootstrapAdmins().length === 0
              ? 'SOFRA_ADMINS is not set. If the list above is also empty, nobody can open the console.'
              : 'SOFRA_ADMINS is set, but nobody in the directory matches it. Check the ids and addresses in it.'}
          </div>
        ) : (
          <div className="stack">
            {fromEnvironment.map((e) => (
              <div className="card" key={e.id}>
                <div className="person">
                  <Initials name={e.displayName} />
                  <div className="person-body">
                    <div className="person-name">{e.displayName}</div>
                    <div className="person-meta">
                      {e.title}, {e.department}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}

import { requireAdmin } from '../../../src/auth/session';
import { bootstrapAdminEmails } from '../../../src/auth/roles';
import { getDb } from '../../../src/db';
import { listGrants } from '../../../src/data/admin';
import { listOffices } from '../../../src/data/offices';
import { countPeople, listPeople } from '../../../src/data/people';
import { envOptional } from '../../../src/lib/env';
import { SENIORITY_LABELS } from '../../../src/services/forms';
import {
  grantAdminAction,
  revokeAdminAction,
  setPersonActiveAction,
  setPersonOfficeAction,
  signOutPersonAction,
  syncDirectoryAction,
} from '../../actions/admin';
import { Pill } from '../../ui';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'People · Sofra' };

const ERRORS: Record<string, string> = {
  self: 'You cannot take away your own access that way.',
  bootstrap: 'That person is named in SOFRA_ADMINS; remove them there instead.',
  inactive: 'Reactivate the person first.',
  nodirectory: 'No directory is configured. Set SOFRA_DIRECTORY.',
};

export default async function PeoplePage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    office?: string;
    error?: string;
    note?: string;
    synced?: string;
  }>;
}) {
  await requireAdmin({ everyOffice: true });
  const params = await searchParams;
  const db = getDb();
  const offices = await listOffices(db);
  const officeFilter = params.office === 'none' ? null : params.office || undefined;
  const [people, grants, counts] = await Promise.all([
    listPeople(db, { search: params.q, officeId: officeFilter, limit: 100 }),
    listGrants(db),
    countPeople(db),
  ]);
  const officeName = new Map(offices.map((o) => [o.id, o.name]));
  const bootstrap = bootstrapAdminEmails();

  return (
    <main>
      <div className="page-head">
        <h1>People</h1>
        <p>
          {counts.active} active, {counts.onboarded} set up, {counts.noOffice} without an office.
          People add themselves by signing in; a deactivated person is signed out everywhere and
          cannot sign back in.
        </p>
      </div>

      {params.error && ERRORS[params.error] ? (
        <p className="error-text">{ERRORS[params.error]}</p>
      ) : null}
      {params.note === 'signedout' ? <div className="note">Signed out everywhere.</div> : null}
      {params.synced ? (
        <div className="note" data-tone="good">
          Directory synced: {params.synced.split('-').join(' new, ')} updated, deactivated.
        </div>
      ) : null}

      <section>
        <form method="get" className="inline">
          <input
            name="q"
            defaultValue={params.q ?? ''}
            placeholder="Name, email or department"
            aria-label="Search"
          />
          <select name="office" defaultValue={params.office ?? ''} aria-label="Office">
            <option value="">Every office</option>
            <option value="none">No office yet</option>
            {offices.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
          <button type="submit">Search</button>
          {envOptional('SOFRA_DIRECTORY') ? (
            <button type="submit" formAction={syncDirectoryAction} formMethod="post">
              Sync from directory now
            </button>
          ) : null}
        </form>
      </section>

      <section>
        <div className="stack">
          {people.map((p) => {
            const mine = grants.filter((g) => g.employeeId === p.id);
            return (
              <article className="card" key={p.id}>
                <div className="spread">
                  <div>
                    <strong>{p.displayName || p.email}</strong>{' '}
                    <span className="faint">{p.email}</span>
                    <div className="faint">
                      {[p.title, p.department, p.seniority ? SENIORITY_LABELS[p.seniority] : null]
                        .filter(Boolean)
                        .join(' · ') || 'Profile not finished'}
                    </div>
                  </div>
                  <div className="row">
                    {!p.active ? <Pill tone="bad">deactivated</Pill> : null}
                    {!p.onboardedAt ? <Pill tone="warn">not set up</Pill> : null}
                    {bootstrap.includes(p.email) ? (
                      <Pill tone="accent">admin (SOFRA_ADMINS)</Pill>
                    ) : null}
                    {mine.map((g) => (
                      <form key={g.id} action={revokeAdminAction} className="inline">
                        <input type="hidden" name="grantId" value={g.id} />
                        <Pill tone="accent">
                          admin:{' '}
                          {g.officeId ? (officeName.get(g.officeId) ?? g.officeId) : 'every office'}
                        </Pill>
                        <button type="submit" data-variant="quiet" aria-label="Revoke">
                          ×
                        </button>
                      </form>
                    ))}
                  </div>
                </div>

                <div className="row" style={{ marginTop: 10 }}>
                  <form action={setPersonOfficeAction} className="inline">
                    <input type="hidden" name="employeeId" value={p.id} />
                    <select name="officeId" defaultValue={p.officeId ?? ''} aria-label="Office">
                      <option value="">No office</option>
                      {offices.map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.name}
                        </option>
                      ))}
                    </select>
                    <button type="submit" data-variant="quiet">
                      Move
                    </button>
                  </form>

                  {p.active ? (
                    <form action={grantAdminAction} className="inline">
                      <input type="hidden" name="employeeId" value={p.id} />
                      <select name="officeId" defaultValue="" aria-label="Admin of">
                        <option value="">Admin of every office</option>
                        {offices.map((o) => (
                          <option key={o.id} value={o.id}>
                            Admin of {o.name}
                          </option>
                        ))}
                      </select>
                      <button type="submit" data-variant="quiet">
                        Grant
                      </button>
                    </form>
                  ) : null}

                  <form action={signOutPersonAction}>
                    <input type="hidden" name="employeeId" value={p.id} />
                    <button type="submit" data-variant="quiet">
                      Sign out everywhere
                    </button>
                  </form>

                  <form action={setPersonActiveAction}>
                    <input type="hidden" name="employeeId" value={p.id} />
                    <input type="hidden" name="active" value={p.active ? 'false' : 'true'} />
                    <button type="submit" data-variant={p.active ? 'danger' : undefined}>
                      {p.active ? 'Deactivate' : 'Reactivate'}
                    </button>
                  </form>
                </div>
              </article>
            );
          })}
          {people.length === 0 ? <p className="faint">Nobody matches.</p> : null}
        </div>
      </section>
    </main>
  );
}

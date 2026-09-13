import { redirect } from 'next/navigation';
import { getStore } from '../../src/store/instance';
import { currentEmployeeId } from '../../src/lib/session';
import { DEMO_PASSWORD } from '../../src/lib/auth';
import { DEMO_USERNAME, FEATURED_EMPLOYEE } from '../../src/store/featured';
import { signIn } from '../actions';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Sign in · Sofra' };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string }>;
}) {
  const params = await searchParams;
  if (await currentEmployeeId(getStore())) redirect(params.next ?? '/');

  return (
    <main className="signin">
      <div className="page-head">
        <h1>Sofra</h1>
        <p>Lunch with three colleagues from other teams, on a day you are already in the office.</p>
      </div>

      <form action={signIn} className="card stack" style={{ maxWidth: 380 }}>
        <input type="hidden" name="next" value={params.next ?? '/'} />

        <label className="field">
          <span>Username</span>
          <input name="username" autoComplete="username" defaultValue={DEMO_USERNAME} required />
        </label>

        <label className="field">
          <span>Password</span>
          <input name="password" type="password" autoComplete="current-password" required />
        </label>

        {params.error ? (
          <p className="error-text">That username and password did not match.</p>
        ) : null}

        <button type="submit" data-variant="primary">
          Sign in
        </button>

        <p className="faint">
          Demo account — <strong>{DEMO_USERNAME}</strong> / <strong>{DEMO_PASSWORD}</strong>. You
          sign in as {FEATURED_EMPLOYEE.displayName}, {FEATURED_EMPLOYEE.title}. One shared password
          so anyone with the link can try it; this is a demo gate, not authentication.
        </p>
      </form>
    </main>
  );
}

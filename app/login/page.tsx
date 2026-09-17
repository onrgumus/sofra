import { redirect } from 'next/navigation';
import { getStore } from '../../src/store/instance';
import { currentEmployeeId } from '../../src/lib/session';
import { safeRedirectPath } from '../../src/lib/redirect';
import { DEMO_PASSWORD } from '../../src/lib/auth';
import { demoModeEnabled } from '../../src/lib/authz';
import { oidcConfig } from '../../src/lib/oidc';
import { WINDOW_MINUTES } from '../../src/lib/throttle';
import { DEMO_USERNAME, FEATURED_EMPLOYEE } from '../../src/store/featured';
import { signIn } from '../actions';
import { TeamsBootstrap } from '../TeamsBootstrap';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Sign in · Sofra' };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string }>;
}) {
  const params = await searchParams;
  const next = safeRedirectPath(params.next);
  if (await currentEmployeeId(getStore())) redirect(next);

  // When a company has wired up its own identity provider, that is the way in.
  // The shared password stays only where demo mode is deliberately on.
  const company = oidcConfig();
  const showPassword = !company || demoModeEnabled();

  return (
    <main className="signin">
      <div className="page-head">
        <h1>Sofra</h1>
        <p>
          You can spend years in a building with people whose work you never see. As more of the
          routine gets automated, what is left is the part that runs on knowing who to ask, and that
          is not on any org chart. Sofra spends an hour you were going to spend anyway on three
          people most likely to teach you something.
        </p>
      </div>

      {/* Inside Teams this signs you in and reloads; elsewhere it does nothing. */}
      <TeamsBootstrap />

      {company ? (
        <div className="card stack" style={{ maxWidth: 380 }}>
          <a
            className="button"
            data-variant="primary"
            href={`/api/auth/oidc/start?next=${encodeURIComponent(next)}`}
          >
            Sign in with your company account
          </a>
          {OIDC_ERRORS[params.error ?? ''] ? (
            <p className="error-text">{OIDC_ERRORS[params.error ?? '']}</p>
          ) : null}
          <p className="faint">
            Takes you to your company&apos;s usual sign-in. Sofra never sees your password, and when
            your account is closed your access to Sofra closes with it.
          </p>
        </div>
      ) : null}

      {showPassword ? (
        <form action={signIn} className="card stack" style={{ maxWidth: 380 }}>
          <input type="hidden" name="next" value={next} />

          <label className="field">
            <span>Username</span>
            <input name="username" autoComplete="username" defaultValue={DEMO_USERNAME} required />
          </label>

          <label className="field">
            <span>Password</span>
            <input name="password" type="password" autoComplete="current-password" required />
          </label>

          {params.error === 'throttled' ? (
            <p className="error-text">Too many attempts. Try again in {WINDOW_MINUTES} minutes.</p>
          ) : params.error === 'bad-credentials' ? (
            <p className="error-text">That username and password did not match.</p>
          ) : null}

          <button type="submit" data-variant="primary">
            Sign in
          </button>

          <div className="or">
            <span>or</span>
          </div>

          <button type="submit" name="mode" value="random">
            Sign in as a random colleague
          </button>

          <p className="faint">
            Demo account: <strong>{DEMO_USERNAME}</strong> / <strong>{DEMO_PASSWORD}</strong>, which
            signs you in as {FEATURED_EMPLOYEE.displayName}, {FEATURED_EMPLOYEE.title}. If several
            people are trying this at once, take a random colleague instead, so you have your own
            account rather than all ticking the same boxes. Either way the password is the same: one
            shared password so anyone with the link can try it, which makes this a demo gate and not
            authentication.
          </p>
        </form>
      ) : null}
    </main>
  );
}

/**
 * What went wrong, in terms that name the next thing to do. The provider's own
 * reason is in the server log; it can mention client ids and redirect URIs, and
 * says nothing useful to the person standing there.
 */
const OIDC_ERRORS: Record<string, string> = {
  denied: 'Your company sign-in did not go through. You can try again.',
  expired: 'That sign-in took too long. Start again.',
  state: 'That sign-in could not be matched to this browser. Start again.',
  nocode: 'Your company sign-in came back incomplete. Start again.',
  token: 'Sofra could not complete the sign-in with your company. Try again shortly.',
  unknown: 'You signed in, but nobody with that account is in the company directory yet.',
  provider: 'Sofra cannot reach your company sign-in at the moment.',
};

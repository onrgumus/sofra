import { redirect } from 'next/navigation';
import { demoMode, demoOpen } from '../../src/auth/demo';
import { current } from '../../src/auth/session';
import { getDb } from '../../src/db';
import { oidcConfig } from '../../src/lib/oidc';
import { safeRedirectPath } from '../../src/lib/redirect';
import { openInTeamsUrl, TEAMS_RETRY_PARAM, teamsOnly } from '../../src/lib/teams-mode';
import { mailboxEnabled } from '../../src/services/mail';
import { requestLinkAction } from '../actions/auth';
import { DemoDoor } from '../DemoDoor';
import { TeamsBootstrap } from '../TeamsBootstrap';
import { TeamsTheme } from '../TeamsTheme';

export const dynamic = 'force-dynamic';
// Walking into the demo can make a day's tables on the way.
export const maxDuration = 60;
export const metadata = { title: 'Sign in · Sofra' };

const ERRORS: Record<string, string> = {
  invalid: 'That does not look like an email address.',
  throttled: 'Too many links asked for. Wait a few minutes and try again.',
  link: 'That sign-in link has expired or has already been used. Ask for a new one.',
  denied: 'Your company sign-in did not go through. You can try again.',
  expired: 'That sign-in took too long. Start again.',
  state: 'That sign-in could not be matched to this browser. Start again.',
  nocode: 'Your company sign-in came back incomplete. Start again.',
  token: 'Sofra could not complete the sign-in with your company. Try again shortly.',
  unknown:
    'You signed in, but that account cannot use Sofra here. Ask an admin to allow your domain.',
  provider: 'Sofra cannot reach your company sign-in at the moment.',
  'demo-busy': 'A lot of people are trying the demo right now. Give it a few minutes.',
  'demo-closed': 'The demo is not open here.',
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{
    error?: string;
    next?: string;
    reauth?: string;
    [TEAMS_RETRY_PARAM]?: string;
  }>;
}) {
  const params = await searchParams;
  const next = safeRedirectPath(params.next);
  const reauth = params.reauth === '1';

  // Somebody already signed in has nothing to do here, unless the console has
  // asked them to prove who they are again.
  if (!reauth && (await current())) redirect(next);

  if (teamsOnly()) {
    return (
      <main className="signin">
        <div className="page-head">
          <h1>Sofra</h1>
        </div>
        <TeamsTheme />
        <TeamsBootstrap
          teamsOnly
          openInTeamsUrl={openInTeamsUrl()}
          retried={params[TEAMS_RETRY_PARAM] === 'retry'}
        />
      </main>
    );
  }

  const company = oidcConfig();
  const error = params.error ? ERRORS[params.error] : null;

  // A public demo has one door, and it asks for nothing: no mail could reach
  // a visitor's invented colleague anyway. The database is only asked when
  // the deployment says demo, so this page still renders without one.
  if (demoMode() && (await demoOpen(getDb()))) {
    return (
      <main className="signin">
        <div className="page-head">
          <h1>Sofra</h1>
          <p>
            Lunch with two or three colleagues from other teams, on the days you are in the office
            anyway.
          </p>
        </div>
        {error ? (
          <p className="error-text" role="alert">
            {error}
          </p>
        ) : null}
        <DemoDoor />
      </main>
    );
  }

  return (
    <main className="signin">
      <div className="page-head">
        <h1>Sofra</h1>
        <p>
          Lunch with two or three colleagues from other teams, on the days you are in the office
          anyway.
        </p>
      </div>

      {/* Inside Teams this signs you in; in a browser it does nothing. */}
      <TeamsBootstrap />

      {reauth ? (
        <div className="note" role="status">
          The console needs a recent sign-in. Sign in again to carry on.
        </div>
      ) : null}
      {error ? (
        <p className="error-text" role="alert">
          {error}
        </p>
      ) : null}

      <form action={requestLinkAction} className="card stack" style={{ maxWidth: 420 }}>
        <input type="hidden" name="next" value={next} />
        <label className="field">
          <span>Work email</span>
          <input
            name="email"
            type="email"
            autoComplete="email"
            inputMode="email"
            required
            placeholder="you@company.com"
          />
        </label>
        <button type="submit" data-variant="primary">
          Email me a sign-in link
        </button>
        <p className="faint">
          No password. The link works once, for fifteen minutes. Only addresses at your company can
          sign in.
        </p>
      </form>

      {company ? (
        <div className="card stack" style={{ maxWidth: 420, marginTop: 12 }}>
          <a className="button" href={`/api/auth/oidc/start?next=${encodeURIComponent(next)}`}>
            Sign in with your company account
          </a>
        </div>
      ) : null}

      {mailboxEnabled() && process.env.NODE_ENV !== 'production' ? (
        <p className="faint" style={{ marginTop: 16 }}>
          Development: mail is not sent, it is kept at <a href="/dev/mailbox">/dev/mailbox</a>.
        </p>
      ) : null}
    </main>
  );
}

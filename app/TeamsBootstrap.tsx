'use client';

import { useEffect, useState } from 'react';
import { TEAMS_RETRY_PARAM } from '../src/lib/teams-mode';

type State =
  | { kind: 'working' }
  | { kind: 'outside' }
  | { kind: 'failed'; message: string }
  | { kind: 'idle' };

/**
 * Signs the visitor in when Sofra is being rendered inside a Teams tab.
 *
 * Teams already knows who they are, so making them type a password would be
 * absurd. This asks Teams for a signed token, hands it to the server, and
 * reloads once the server has issued a session. The import is dynamic, so the
 * SDK never loads in a normal browser unless this deployment is Teams-only.
 *
 * The reload carries a marker. If the page comes back with it and still signed
 * out, the server issued a session and this Teams client did not keep it,
 * which is what a client blocking cookies inside apps looks like. Signing in
 * again would only produce the same result, forever, so it stops and says so.
 */
export function TeamsBootstrap({
  teamsOnly = false,
  openInTeamsUrl = null,
  retried = false,
}: {
  teamsOnly?: boolean;
  openInTeamsUrl?: string | null;
  retried?: boolean;
}) {
  const [state, setState] = useState<State>(teamsOnly ? { kind: 'working' } : { kind: 'idle' });

  useEffect(() => {
    let cancelled = false;

    async function signIn() {
      try {
        const teams = await import('@microsoft/teams-js');
        await teams.app.initialize();

        if (retried) {
          if (!cancelled) {
            setState({
              kind: 'failed',
              message:
                'Teams signed you in, but this Teams client did not keep the session. It is ' +
                'probably blocking cookies inside apps. Try Teams in Edge or Chrome.',
            });
          }
          return;
        }

        const token = await teams.authentication.getAuthToken();
        const response = await fetch('/api/auth/teams', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token }),
        });

        if (cancelled) return;
        if (!response.ok) {
          setState({
            kind: 'failed',
            message:
              response.status === 403
                ? 'Your Teams account is not in this company directory.'
                : 'Teams could not sign you in.',
          });
          return;
        }

        const url = new URL(window.location.href);
        url.searchParams.set(TEAMS_RETRY_PARAM, 'retry');
        window.location.replace(url.toString());
      } catch {
        // Not inside Teams, or the user dismissed the consent prompt. Where the
        // ordinary sign-in is still on the page that is not an error; where
        // Teams is the only way in, say where to go.
        if (!cancelled) setState(teamsOnly ? { kind: 'outside' } : { kind: 'idle' });
      }
    }

    void signIn();
    return () => {
      cancelled = true;
    };
  }, [teamsOnly, retried]);

  switch (state.kind) {
    case 'idle':
      return null;
    case 'working':
      return (
        <p className="faint" role="status">
          Signing you in through Teams…
        </p>
      );
    case 'failed':
      return <p className="error-text">{state.message}</p>;
    case 'outside':
      return (
        <div className="card stack" style={{ maxWidth: 420 }}>
          <p>Sofra is a Teams app. Open it from Teams, where you are already signed in.</p>
          {openInTeamsUrl ? (
            <a className="button" data-variant="primary" href={openInTeamsUrl}>
              Open Sofra in Teams
            </a>
          ) : null}
        </div>
      );
  }
}

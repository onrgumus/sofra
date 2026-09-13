'use client';

import { useEffect, useState } from 'react';

/**
 * Signs the visitor in when Sofra is being rendered inside a Teams tab.
 *
 * Teams already knows who they are, so making them type a password would be
 * absurd. This asks Teams for a signed token, hands it to the server, and
 * reloads once the server has issued a session. Outside Teams it does nothing
 * at all. The import is dynamic, so the SDK never loads in a normal browser.
 */
export function TeamsBootstrap() {
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function signIn() {
      try {
        const teams = await import('@microsoft/teams-js');
        await teams.app.initialize();

        const token = await teams.authentication.getAuthToken();
        const response = await fetch('/api/auth/teams', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token }),
        });

        if (cancelled) return;
        if (!response.ok) {
          setFailed(
            response.status === 403
              ? 'Your Teams account is not in this company directory.'
              : 'Teams could not sign you in.',
          );
          return;
        }
        window.location.reload();
      } catch {
        // Not inside Teams, or the user dismissed the consent prompt. The
        // ordinary sign-in page is still there, so this is not an error state.
        if (!cancelled) setFailed(null);
      }
    }

    void signIn();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!failed) return null;
  return <p className="error-text">{failed}</p>;
}

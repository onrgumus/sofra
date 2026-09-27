import { envOptional } from './env';

/**
 * Whether Sofra is only a Teams app.
 *
 * A company that installs it as a Teams app has no use for the parts that make
 * it a website: a password form, a "sign in with your company account" button,
 * a sign-out link that Teams would undo on the next load. With this on, sign-in
 * happens only through the token Teams hands the tab, and opening Sofra in a
 * browser says where it lives instead of asking for credentials. Nothing is
 * removed, so the demo and a browser deployment work as before with it off.
 */
export function teamsOnly(): boolean {
  return process.env.SOFRA_TEAMS_ONLY === 'true';
}

/**
 * Whether the session cookie has to survive being inside a Teams iframe, which
 * is a cross-site frame on every Teams client. Teams-only implies it.
 */
export function embeddedInTeams(): boolean {
  return process.env.SOFRA_ALLOW_EMBEDDING === 'true' || teamsOnly();
}

/**
 * Marks the return from a Teams sign-in, so a session that did not stick is
 * noticed rather than signed in again, and again.
 */
export const TEAMS_RETRY_PARAM = 'teams';

/** Entity id of the personal tab. Must match `staticTabs` in teams/manifest.json. */
export const LUNCHES_TAB = 'sofra.lunches';

/**
 * A link that opens the Sofra tab in whichever Teams client the person uses,
 * or null when the deployment has not been told its Teams app id.
 */
export function openInTeamsUrl(entityId: string = LUNCHES_TAB): string | null {
  const appId = envOptional('TEAMS_APP_ID');
  if (!appId) return null;
  return `https://teams.microsoft.com/l/entity/${encodeURIComponent(appId)}/${encodeURIComponent(entityId)}`;
}

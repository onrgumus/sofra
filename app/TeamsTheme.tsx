'use client';

import { useEffect } from 'react';

/**
 * Follows the Teams theme rather than the operating system's.
 *
 * Teams has its own light and dark setting, independent of the OS, and a tab
 * that ignores it is a white rectangle in the middle of a dark client. Outside
 * Teams the SDK fails to initialise and the page keeps following the OS.
 * High contrast is drawn with the dark palette, the nearest one there is.
 */
export function TeamsTheme() {
  useEffect(() => {
    let cancelled = false;

    async function follow() {
      try {
        const teams = await import('@microsoft/teams-js');
        await teams.app.initialize();

        const apply = (theme: string) => {
          if (cancelled) return;
          document.documentElement.dataset.theme = theme === 'default' ? 'light' : 'dark';
        };
        apply((await teams.app.getContext()).app.theme);
        teams.app.registerOnThemeChangeHandler(apply);
      } catch {
        // Not inside Teams: nothing to follow.
      }
    }

    void follow();
    return () => {
      cancelled = true;
    };
  }, []);

  return null;
}

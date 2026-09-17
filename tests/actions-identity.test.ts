import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('../app/actions.ts', import.meta.url), 'utf8');

/**
 * A source-level guard, deliberately.
 *
 * Server actions need a request context, so calling them here would mean
 * mocking Next's cookies, the store singleton and the redirect. What actually
 * needs protecting is narrower than that and can be stated exactly: no action
 * may decide who is acting from a field in the form it was handed.
 *
 * It mattered. Three actions took `employeeId` from the form, so any signed-in
 * employee could decline a colleague's lunch, opt them into one they never
 * asked for, or mark them out of the office, which collapses their table and
 * mails the three people still expecting them.
 */
function bodyOf(name: string): string {
  const start = source.indexOf(`export async function ${name}(`);
  expect(start, `${name} not found in app/actions.ts`).toBeGreaterThan(-1);

  const next = source.indexOf('\nexport async function ', start + 1);
  return source.slice(start, next === -1 ? source.length : next);
}

/** Everything a person can do to their own lunch. */
const SELF_SERVICE = [
  'setAttendance',
  'toggleLunch',
  'respondToInvite',
  'setReminders',
  'updateProfile',
];

describe('who an action acts as', () => {
  it.each(SELF_SERVICE)('%s takes the person from the session, not the form', (name) => {
    const body = bodyOf(name);

    expect(body).not.toContain("required(formData, 'employeeId')");
    expect(body).not.toContain("formData.get('employeeId')");
    expect(body).toMatch(/actingEmployee\(\)|currentEmployeeId\(/);
  });

  it('respondToInvite refuses a table the replier is not seated at', () => {
    // Otherwise the group id, which is guessable, is enough to reply on behalf
    // of four strangers.
    expect(bodyOf('respondToInvite')).toContain('group.members.some');
  });

  it('only the gated impersonation door reads an employee id from a form', () => {
    // switchEmployee is the account switcher and is behind demoModeEnabled().
    // grantAdmin and revokeAdmin name somebody else on purpose, and take the
    // actor from requireAdmin() rather than the form.
    const readers = [...source.matchAll(/export async function (\w+)\(/g)]
      .map((match) => match[1]!)
      .filter((name) => bodyOf(name).includes("required(formData, 'employeeId')"));

    expect(readers.sort()).toEqual(['grantAdmin', 'revokeAdmin', 'switchEmployee']);
  });

  it('every action that is not self-service checks admin or demo mode first', () => {
    const guarded = ['runMatching', 'clearMatching', 'sendInvites', 'grantAdmin', 'revokeAdmin'];
    for (const name of guarded) {
      expect(bodyOf(name), name).toContain('requireAdmin()');
    }
    expect(bodyOf('switchEmployee')).toContain('demoModeEnabled()');
  });
});

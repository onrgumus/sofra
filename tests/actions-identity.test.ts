import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Source-level guards over the server actions, deliberately.
 *
 * Calling an action needs a request context, cookies and a database. What
 * actually needs protecting is narrower than that and can be stated exactly:
 * who an action acts as comes from the session, never from the form, and every
 * console action checks the admin's rights before it does anything else.
 */
function source(file: string): string {
  return readFileSync(new URL(`../app/actions/${file}`, import.meta.url), 'utf8');
}

function actions(file: string): { name: string; body: string }[] {
  const text = source(file);
  return [...text.matchAll(/export async function (\w+)\(/g)].map((match) => {
    const start = match.index!;
    const next = text.indexOf('\nexport async function ', start + 1);
    return { name: match[1]!, body: text.slice(start, next === -1 ? text.length : next) };
  });
}

describe('who an action acts as', () => {
  it.each(actions('lunch.ts'))('$name takes the person from the session', ({ body }) => {
    expect(body).toContain('requireOnboarded()');
    expect(body).not.toMatch(/formData\.get\('employeeId'\)|field\(formData, 'employeeId'\)/);
  });

  it.each(actions('profile.ts'))('$name edits only the signed-in person', ({ body }) => {
    expect(body).toContain('requirePerson()');
    expect(body).not.toContain("'employeeId'");
  });
});

describe('the console', () => {
  const admin = actions('admin.ts');

  it('has every action check the admin first', () => {
    for (const { name, body } of admin) {
      const guard = body.indexOf('requireAdmin(');
      expect(guard, name).toBeGreaterThan(-1);
      // Nothing touches the database before the guard.
      const firstWrite = body.search(/getDb\(\)|await (add|remove|set|update|create|delete)/);
      expect(firstWrite === -1 || firstWrite > guard, name).toBe(true);
    }
  });

  it('keeps company-wide actions to every-office admins', () => {
    const companyWide = [
      'addDomainAction',
      'removeDomainAction',
      'addDepartmentAction',
      'renameDepartmentAction',
      'removeDepartmentAction',
      'setCompanyNameAction',
      'syncDirectoryAction',
      'setPersonActiveAction',
      'signOutPersonAction',
      'setPersonOfficeAction',
      'grantAdminAction',
      'revokeAdminAction',
    ];
    for (const name of companyWide) {
      const found = admin.find((a) => a.name === name);
      expect(found, name).toBeDefined();
      expect(found!.body, name).toContain('requireAdmin({ everyOffice: true })');
    }
  });

  it('scopes office actions to the office being changed', () => {
    for (const name of [
      'addHolidayAction',
      'removeHolidayAction',
      'planNowAction',
      'remindNowAction',
    ]) {
      const found = admin.find((a) => a.name === name)!;
      expect(found.body, name).toContain('requireAdmin({ officeId })');
    }
  });

  it('records every change in the audit log', () => {
    for (const { name, body } of admin) {
      if (name === 'saveOfficeAction') continue;
      expect(body, name).toMatch(/audit\(admin,/);
    }
    expect(admin.find((a) => a.name === 'saveOfficeAction')!.body).toMatch(
      /office\.(create|update)/,
    );
  });
});

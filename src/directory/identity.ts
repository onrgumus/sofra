import type { Employee } from '../core/types';

/**
 * The one hard problem in putting this into a real company.
 *
 * A person has a different identifier in every system they touch. Workday has
 * an employee number and a work email. Entra ID has an immutable object id, a
 * user principal name, and a mail attribute, and in a great many tenants the
 * last two are different strings: the UPN is `ogumus@acme.onmicrosoft.com`
 * while mail is `onur.gumus@acme.com`. Slack has its own id and whichever
 * address the person signed up with. The desk-booking tool has a badge number.
 *
 * Matching on the primary email alone means that in any tenant where the UPN
 * is not the mail address, signing in through Teams finds nobody and the
 * product simply does not work for that person. So an employee may carry other
 * addresses that mean them, and ids in other systems, and everything resolves
 * through here rather than each integration inventing its own comparison.
 */

/** Systems Sofra knows how to be told about. Any string works; these are named
 * because they are the ones the shipped adapters use. */
export const ENTRA = 'entra';
export const SLACK = 'slack';
export const WORKDAY = 'workday';

export interface IdentityQuery {
  /** An immutable id from another system, when one is available. Preferred. */
  externalId?: { system: string; value: string };
  /** Any address that might mean this person: mail, UPN, an alias. */
  addresses?: readonly (string | undefined)[];
}

/**
 * Finds the person, most reliable evidence first.
 *
 * An external id beats an address because addresses change and ids do not:
 * somebody who marries and takes a new surname keeps their Entra object id and
 * gets a new UPN and a new mail, and only the id still points at them.
 */
export function findEmployee(
  employees: readonly Employee[],
  query: IdentityQuery,
): Employee | null {
  if (query.externalId) {
    const { system, value } = query.externalId;
    const byId = employees.find(
      (e) => e.externalIds?.[system]?.toLowerCase() === value.toLowerCase(),
    );
    if (byId) return byId;
  }

  for (const address of query.addresses ?? []) {
    const wanted = normaliseAddress(address);
    if (!wanted) continue;

    // Primary address first, so a person whose own mail is somebody else's
    // recorded alias is still found as themselves.
    const byEmail = employees.find((e) => normaliseAddress(e.email) === wanted);
    if (byEmail) return byEmail;

    const byAlias = employees.find((e) =>
      (e.aliases ?? []).some((alias) => normaliseAddress(alias) === wanted),
    );
    if (byAlias) return byAlias;
  }

  return null;
}

/** Case and surrounding space only. Corporate mail is not Gmail: dots and plus
 * signs are significant, and stripping them would merge two real people. */
export function normaliseAddress(address: string | undefined): string | null {
  const trimmed = address?.trim().toLowerCase();
  return trimmed ? trimmed : null;
}

/** Every address that means this person, for collision checks and diagnostics. */
export function addressesOf(employee: Employee): string[] {
  return [employee.email, ...(employee.aliases ?? [])]
    .map(normaliseAddress)
    .filter((a): a is string => a !== null);
}

/**
 * The reverse direction: a vendor's id for somebody, back to ours.
 *
 * The desk-booking feed answers with whatever it calls people, which is rarely
 * what Sofra calls them. Every attendance adapter already takes a resolver for
 * exactly this reason; this builds one from the directory, so a company that
 * has put its ids in the export gets the mapping for free instead of writing
 * a lookup table.
 *
 * Returns null for somebody it does not recognise, which drops the record.
 * That is right for contractors, meeting rooms and service accounts, all of
 * which appear in desk bookings and none of which should be seated at lunch.
 */
export function resolverFromDirectory(
  employees: readonly Employee[],
  system?: string,
): (vendorId: string) => string | null {
  const byKey = new Map<string, string>();

  for (const employee of employees) {
    // Our own id first, so an export that already uses it needs nothing else.
    byKey.set(employee.id.toLowerCase(), employee.id);
    for (const address of addressesOf(employee)) byKey.set(address, employee.id);

    const external = system ? employee.externalIds?.[system] : undefined;
    if (external) byKey.set(external.toLowerCase(), employee.id);
  }

  return (vendorId) => byKey.get(vendorId.trim().toLowerCase()) ?? null;
}

import { afterEach, describe, expect, it, vi } from 'vitest';
import { EntraDirectory, readEntraUsers, seniorityFrom } from '../src/directory';
import { configuredDirectory, officeKeywords } from '../src/lib/directory';
import type { Office } from '../src/data/types';
import { officeFixture } from './support/db';

const NOW = Date.parse('2026-09-26T09:00:00Z');

const OFFICES: Office[] = [
  officeFixture({ id: 'IST-HQ', name: 'Istanbul HQ', locationKeywords: ['maslak'] }),
  officeFixture({
    id: 'AMS-1',
    name: 'Amsterdam',
    timeZone: 'Europe/Amsterdam',
    locationKeywords: [],
  }),
];

const LOCATIONS = { 'IST-HQ': ['istanbul', 'maslak'], 'AMS-1': ['amsterdam'] };

/** A Graph user the way `/users?$select=...&$expand=manager` returns one. */
function user(id: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    displayName: `Person ${id}`,
    mail: `${id}@acme.com`,
    userPrincipalName: `${id}@acme.com`,
    proxyAddresses: [`SMTP:${id}@acme.com`],
    jobTitle: 'Risk Analyst',
    department: 'Risk',
    officeLocation: 'Istanbul HQ',
    preferredLanguage: 'tr-TR',
    employeeHireDate: '2023-03-01T00:00:00Z',
    accountEnabled: true,
    userType: 'Member',
    manager: { id: 'boss-1' },
    ...overrides,
  };
}

function read(users: Record<string, unknown>[], defaultOfficeId?: string) {
  return readEntraUsers(users, { officeLocations: LOCATIONS, defaultOfficeId, now: () => NOW });
}

describe('reading people from Entra ID', () => {
  it('turns a user into somebody Sofra can seat', () => {
    const { employees, skipped } = read([user('oid-1')]);

    expect(skipped).toEqual([]);
    expect(employees).toEqual([
      {
        id: 'oid-1',
        displayName: 'Person oid-1',
        email: 'oid-1@acme.com',
        title: 'Risk Analyst',
        seniority: 'mid',
        department: 'Risk',
        team: 'manager:boss-1',
        officeId: 'IST-HQ',
        languages: ['tr'],
        tenureMonths: 42,
        interests: [],
        externalIds: { entra: 'oid-1' },
      },
    ]);
  });

  it('keeps the UPN and secondary addresses when they are not the mail', () => {
    // The common tenant: UPN on the onmicrosoft domain, mail on the company's.
    const { employees } = read([
      user('oid-1', {
        mail: 'onur.gumus@acme.com',
        userPrincipalName: 'ogumus@acme.onmicrosoft.com',
        proxyAddresses: ['SMTP:onur.gumus@acme.com', 'smtp:onur@acme.com.tr', 'X500:/o=legacy'],
      }),
    ]);

    expect(employees[0]!.aliases).toEqual(['ogumus@acme.onmicrosoft.com', 'onur@acme.com.tr']);
  });

  it('leaves out the accounts that are not people who eat lunch', () => {
    const { employees, skipped } = read([
      user('disabled', { accountEnabled: false }),
      user('guest', { userType: 'Guest' }),
      user('room', { mail: null }),
      user('nodept', { department: '' }),
      user('future', { employeeHireDate: '2026-11-01T00:00:00Z' }),
      user('ok'),
    ]);

    expect(employees.map((e) => e.id)).toEqual(['ok']);
    expect(skipped.map((s) => [s.userId, s.reason])).toEqual([
      ['disabled', 'account disabled'],
      ['guest', 'guest account'],
      ['room', 'no mailbox'],
      ['nodept', 'no department'],
      ['future', 'starts on 2026-11-01'],
    ]);
  });

  it('finds the office in free text, whatever the case or the Turkish letters', () => {
    const { employees } = read([
      user('a', { officeLocation: 'İSTANBUL - Maslak 5. kat' }),
      user('b', { officeLocation: 'Amsterdam Zuid' }),
    ]);

    expect(employees.map((e) => [e.id, e.officeId])).toEqual([
      ['a', 'IST-HQ'],
      ['b', 'AMS-1'],
    ]);
  });

  it('prefers the more specific office when two match', () => {
    const { employees } = readEntraUsers([user('a', { officeLocation: 'Istanbul Maslak' })], {
      officeLocations: { 'IST-HQ': ['istanbul'], 'IST-MAS': ['istanbul maslak'] },
      now: () => NOW,
    });

    expect(employees[0]!.officeId).toBe('IST-MAS');
  });

  it('skips somebody whose office it cannot place, unless told where they belong', () => {
    // Guessing a building for somebody in another city seats them at a lunch
    // they cannot reach, so this is opt-in.
    const people = [
      user('izmir', { officeLocation: 'Izmir' }),
      user('blank', { officeLocation: null }),
    ];

    const strict = read(people);
    expect(strict.employees).toEqual([]);
    expect(strict.skipped.map((s) => s.reason)).toEqual([
      'office "Izmir" matches no office',
      'no office location',
    ]);

    const lenient = read(people, 'IST-HQ');
    expect(lenient.employees.map((e) => e.officeId)).toEqual(['IST-HQ', 'IST-HQ']);
  });

  it('refuses two accounts claiming one address', () => {
    const { employees, skipped } = read([
      user('first', { mail: 'shared@acme.com' }),
      user('second', { userPrincipalName: 'shared@acme.com' }),
    ]);

    expect(employees.map((e) => e.id)).toEqual(['first']);
    expect(skipped[0]!.reason).toBe('address shared@acme.com already belongs to first');
  });

  it('treats people with the same manager as one team, and falls back to the department', () => {
    const { employees } = read([
      user('a', { manager: { id: 'm' } }),
      user('b', { manager: { id: 'm' } }),
      user('ceo', { manager: undefined, department: 'Board' }),
    ]);

    expect(employees.map((e) => e.team)).toEqual(['manager:m', 'manager:m', 'Board']);
  });

  it('degrades the way a thin CSV row does', () => {
    const { employees } = read([
      user('thin', { jobTitle: null, preferredLanguage: null, employeeHireDate: null }),
    ]);

    expect(employees[0]).toMatchObject({
      title: 'Risk',
      seniority: 'mid',
      languages: ['en'],
      tenureMonths: 0,
    });
  });

  it('prefers a grade attribute over the job title', () => {
    const { employees } = readEntraUsers(
      [
        user('a', {
          jobTitle: 'Analyst',
          onPremisesExtensionAttributes: { extensionAttribute5: 'Director' },
        }),
      ],
      { officeLocations: LOCATIONS, seniorityAttribute: 'extensionAttribute5', now: () => NOW },
    );

    expect(employees[0]!.seniority).toBe('director');
  });
});

describe('reading seniority from a job title', () => {
  it.each([
    ['Senior Software Engineer', 'senior'],
    ['Sr. Data Scientist', 'senior'],
    ['Kıdemli Uzman', 'senior'],
    ['Engineering Manager', 'manager'],
    ['Senior Manager', 'manager'],
    ['Satış Müdürü', 'manager'],
    ['Müdür Yardımcısı', 'manager'],
    ['Genel Müdür Yardımcısı', 'director'],
    ['Head of Risk', 'director'],
    ['CTO', 'director'],
    ['Direktör', 'director'],
    ['Team Lead', 'lead'],
    ['Takım Lideri', 'lead'],
    ['Stajyer', 'intern'],
    ['Summer Intern', 'intern'],
    ['Junior Analyst', 'junior'],
    ['Uzman Yardımcısı', 'junior'],
  ])('%s is %s', (title, level) => {
    expect(seniorityFrom(title)).toBe(level);
  });

  it.each(['Internal Auditor', 'Coordinator', 'Uzman', 'Software Engineer'])(
    '%s says nothing about seniority',
    (title) => {
      // Whole-word matching in English: an internal auditor is not an intern,
      // and a coordinator is not a COO.
      expect(seniorityFrom(title)).toBeNull();
    },
  );
});

describe('paging through a tenant', () => {
  it('follows next links, and reads only the pilot group when one is set', async () => {
    const calls: string[] = [];
    const graphGet = async (path: string): Promise<Record<string, unknown>> => {
      calls.push(path);
      if (path === '/users?$skiptoken=page2') return { value: [user('c')] };
      if (path.startsWith('/users?$select=')) {
        return {
          value: [user('a'), user('b')],
          '@odata.nextLink': 'https://graph.microsoft.com/v1.0/users?$skiptoken=page2',
        };
      }
      if (path.startsWith('/groups/pilot/transitiveMembers')) {
        return { value: [{ id: 'a' }, { id: 'c' }] };
      }
      throw new Error(`unexpected ${path}`);
    };

    const directory = new EntraDirectory({
      graphGet,
      officeLocations: LOCATIONS,
      groupId: 'pilot',
      now: () => NOW,
      onSkipped: () => {},
    });

    expect((await directory.listEmployees()).map((e) => e.id)).toEqual(['a', 'c']);
    expect(calls[0]).toContain('$expand=manager($select=id)');
    expect(calls).toContain('/users?$skiptoken=page2');
  });

  it('refuses a next link that leaves Graph', async () => {
    const directory = new EntraDirectory({
      graphGet: async () => ({ value: [], '@odata.nextLink': 'https://evil.example/users' }),
      officeLocations: LOCATIONS,
      onSkipped: () => {},
    });

    await expect(directory.listEmployees()).rejects.toThrow(/Unexpected Graph next link/);
  });
});

describe('configuring the directory', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('recognises each office by its keywords, its name and its id', () => {
    expect(officeKeywords(OFFICES)).toEqual({
      'IST-HQ': ['IST-HQ', 'Istanbul HQ', 'maslak'],
      'AMS-1': ['AMS-1', 'Amsterdam'],
    });
  });

  it('is off unless asked for, and says what it is missing', () => {
    expect(configuredDirectory(OFFICES)).toBeNull();

    vi.stubEnv('SOFRA_DIRECTORY', 'entra');
    expect(() => configuredDirectory(OFFICES)).toThrow(/MS_TENANT_ID/);

    vi.stubEnv('MS_TENANT_ID', 't');
    vi.stubEnv('MS_CLIENT_ID', 'c');
    vi.stubEnv('MS_CLIENT_SECRET', 's');
    expect(configuredDirectory(OFFICES)?.source).toBe('entra');

    vi.stubEnv('SOFRA_ENTRA_SENIORITY_ATTRIBUTE', 'extensionAttribute99');
    expect(() => configuredDirectory(OFFICES)).toThrow(/extensionAttribute1 to 15/);
  });

  it('refuses a directory kind it does not know', () => {
    vi.stubEnv('SOFRA_DIRECTORY', 'workday');
    expect(() => configuredDirectory(OFFICES)).toThrow(/entra/);
  });

  it('needs a source for a CSV directory', () => {
    vi.stubEnv('SOFRA_DIRECTORY', 'csv');
    expect(() => configuredDirectory(OFFICES)).toThrow(/SOFRA_DIRECTORY_CSV/);
  });
});

describe('reading leniently, for a sync', () => {
  it('keeps somebody whose office or department it cannot read, with those left empty', () => {
    const { employees, skipped } = readEntraUsers(
      [
        {
          id: 'x',
          displayName: 'X',
          mail: 'x@acme.com',
          department: null,
          officeLocation: 'Izmir',
          accountEnabled: true,
          userType: 'Member',
        },
      ],
      { officeLocations: { 'IST-HQ': ['istanbul'] }, lenient: true, now: () => NOW },
    );
    expect(skipped).toEqual([]);
    expect(employees[0]).toMatchObject({ officeId: '', department: '' });
  });
});

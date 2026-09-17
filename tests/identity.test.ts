import { describe, expect, it } from 'vitest';
import {
  ENTRA,
  SLACK,
  addressesOf,
  findEmployee,
  normaliseAddress,
  resolverFromDirectory,
} from '../src/directory/identity';
import { readDirectoryCsv } from '../src/directory';
import { employee } from './helpers';

/**
 * The join between a company's systems, which is where putting this into a
 * real company actually gets hard.
 */
const onur = employee('e1', {
  displayName: 'Onur Gumus',
  // What Workday exports: the mail attribute.
  email: 'onur.gumus@acme.com',
  // What Entra signs tokens with in this tenant: a different string.
  aliases: ['ogumus@acme.onmicrosoft.com'],
  externalIds: { [ENTRA]: 'oid-onur' },
});

const deniz = employee('e2', {
  displayName: 'Deniz Arslan',
  email: 'deniz.arslan@acme.com',
});

const people = [onur, deniz];

describe('finding who somebody is', () => {
  it('matches the mail address the HR export carries', () => {
    expect(findEmployee(people, { addresses: ['onur.gumus@acme.com'] })?.id).toBe('e1');
  });

  it('matches a UPN that is not the mail address', () => {
    // The case that broke Teams sign-in for a whole tenant: Entra says
    // ogumus@acme.onmicrosoft.com, Workday says onur.gumus@acme.com.
    expect(findEmployee(people, { addresses: ['ogumus@acme.onmicrosoft.com'] })?.id).toBe('e1');
  });

  it('ignores case and stray spacing, which directories are full of', () => {
    expect(findEmployee(people, { addresses: ['  Onur.Gumus@ACME.com '] })?.id).toBe('e1');
  });

  it('prefers an external id over any address', () => {
    // Somebody marries, HR changes their address, and the token still carries
    // the object id it always did. Only the id still points at them.
    const renamed = [{ ...onur, email: 'onur.yilmaz@acme.com', aliases: [] }, deniz];

    expect(
      findEmployee(renamed, {
        externalId: { system: ENTRA, value: 'oid-onur' },
        addresses: ['onur.gumus@acme.com'],
      })?.id,
    ).toBe('e1');
  });

  it('falls back to the address when the id is not known yet', () => {
    // Day one: nobody has signed in, so no object ids have been learned.
    const fresh = [{ ...onur, externalIds: {} }, deniz];

    expect(
      findEmployee(fresh, {
        externalId: { system: ENTRA, value: 'oid-onur' },
        addresses: ['onur.gumus@acme.com'],
      })?.id,
    ).toBe('e1');
  });

  it('does not match an id from a different system', () => {
    expect(findEmployee(people, { externalId: { system: SLACK, value: 'oid-onur' } })).toBeNull();
  });

  it('prefers a primary address over somebody else having it as an alias', () => {
    // A stale alias on one record must not shadow the person who owns it.
    const stale = [{ ...deniz, aliases: ['onur.gumus@acme.com'] }, onur];

    expect(findEmployee(stale, { addresses: ['onur.gumus@acme.com'] })?.id).toBe('e1');
  });

  it('returns nobody rather than a guess', () => {
    expect(findEmployee(people, { addresses: ['stranger@elsewhere.com'] })).toBeNull();
    expect(findEmployee(people, {})).toBeNull();
    expect(findEmployee(people, { addresses: [undefined, ''] })).toBeNull();
  });

  it('keeps dots and plus signs significant, because corporate mail is not Gmail', () => {
    // onur.gumus@ and onurgumus@ are two different mailboxes at most companies,
    // and merging them would seat one person as another.
    expect(findEmployee(people, { addresses: ['onurgumus@acme.com'] })).toBeNull();
    expect(normaliseAddress(' A@B.com ')).toBe('a@b.com');
  });

  it('lists every address that means a person', () => {
    expect(addressesOf(onur)).toEqual(['onur.gumus@acme.com', 'ogumus@acme.onmicrosoft.com']);
  });
});

describe('a directory carrying the other systems', () => {
  const csv = [
    'employee_id,display_name,email,department,office_id,aliases,entra_object_id,slack_user_id',
    'e1,Onur Gumus,onur.gumus@acme.com,Digital,IST-HQ,ogumus@acme.onmicrosoft.com;o.gumus@acme.com,oid-onur,U01ONUR',
    'e2,Deniz Arslan,deniz.arslan@acme.com,Risk,IST-HQ,,,',
  ].join('\n');

  it('reads aliases and external ids', () => {
    const { employees, skipped } = readDirectoryCsv(csv);

    expect(skipped).toEqual([]);
    expect(employees[0]?.aliases).toEqual(['ogumus@acme.onmicrosoft.com', 'o.gumus@acme.com']);
    expect(employees[0]?.externalIds).toEqual({ entra: 'oid-onur', slack: 'U01ONUR' });
  });

  it('leaves them off entirely when the columns are absent', () => {
    expect(readDirectoryCsv(csv).employees[1]?.aliases).toBeUndefined();
    expect(readDirectoryCsv(csv).employees[1]?.externalIds).toBeUndefined();
  });

  it("refuses a row claiming an address that is already somebody else's", () => {
    // Two people sharing an address would make sign-in resolve to whichever row
    // happened to be read first, which is a way to read a colleague's lunches.
    const clash = [
      'employee_id,display_name,email,department,office_id,aliases',
      'e1,Onur Gumus,onur.gumus@acme.com,Digital,IST-HQ,',
      'e2,Deniz Arslan,deniz.arslan@acme.com,Risk,IST-HQ,onur.gumus@acme.com',
    ].join('\n');

    const { employees, skipped } = readDirectoryCsv(clash);
    expect(employees.map((e) => e.id)).toEqual(['e1']);
    expect(skipped[0]?.reason).toContain('already belongs to e1');
  });

  it('lets the person who owns an address keep it when a later row is dropped', () => {
    const clash = [
      'employee_id,display_name,email,department,office_id',
      'e1,Onur Gumus,shared@acme.com,Digital,IST-HQ',
      'e2,Deniz Arslan,shared@acme.com,Risk,IST-HQ',
    ].join('\n');

    const { employees } = readDirectoryCsv(clash);
    expect(employees).toHaveLength(1);
    expect(findEmployee(employees, { addresses: ['shared@acme.com'] })?.id).toBe('e1');
  });
});

describe('mapping a vendor id back to ours', () => {
  const people = [
    employee('e1', {
      email: 'onur.gumus@acme.com',
      aliases: ['ogumus@acme.onmicrosoft.com'],
      externalIds: { [ENTRA]: 'oid-onur' },
    }),
    employee('e2', { email: 'deniz.arslan@acme.com' }),
  ];

  const resolve = resolverFromDirectory(people, ENTRA);

  it('accepts whatever the desk tool happens to call somebody', () => {
    expect(resolve('e1')).toBe('e1');
    expect(resolve('onur.gumus@acme.com')).toBe('e1');
    expect(resolve('ogumus@acme.onmicrosoft.com')).toBe('e1');
    expect(resolve('oid-onur')).toBe('e1');
  });

  it('is not fussy about case or spacing', () => {
    expect(resolve('  OID-ONUR ')).toBe('e1');
  });

  it('drops who it does not recognise, rather than inventing a seat', () => {
    // Desk bookings are full of contractors, meeting rooms and service
    // accounts. None of them should turn up at lunch.
    expect(resolve('meeting-room-4')).toBeNull();
    expect(resolve('')).toBeNull();
  });

  it('ignores an external id when told a different system', () => {
    expect(resolverFromDirectory(people, SLACK)('oid-onur')).toBeNull();
  });
});

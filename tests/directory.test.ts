import { describe, expect, it } from 'vitest';
import { CsvDirectory, readDirectoryCsv, staticDirectory } from '../src/directory';
import { SqliteStore } from '../src/store/sqlite';
import { ManualAttendanceProvider } from '../src/providers';

const HEADER =
  'employee_id,display_name,email,title,seniority,department,team,office_id,languages,tenure_months,interests';

describe('reading a company directory', () => {
  it('reads a full row', () => {
    const { employees, skipped } = readDirectoryCsv(
      `${HEADER}\ne17,Deniz Arslan,deniz@acme.com,Risk Analyst,senior,Risk,Risk/Credit,IST-HQ,tr;en,42,cycling;cooking`,
    );

    expect(skipped).toEqual([]);
    expect(employees).toEqual([
      {
        id: 'e17',
        displayName: 'Deniz Arslan',
        email: 'deniz@acme.com',
        title: 'Risk Analyst',
        seniority: 'senior',
        department: 'Risk',
        team: 'Risk/Credit',
        officeId: 'IST-HQ',
        languages: ['tr', 'en'],
        tenureMonths: 42,
        interests: ['cycling', 'cooking'],
      },
    ]);
  });

  it('accepts a row with only the five fields a lunch needs', () => {
    // An HR export with nothing but name, address, department and office is a
    // realistic first day. Demanding interests and tenure would mean nobody
    // gets started.
    const { employees, skipped } = readDirectoryCsv(
      'employee_id,display_name,email,department,office_id\ne1,Ada Lovelace,ada@acme.com,Engineering,IST-HQ',
    );

    expect(skipped).toEqual([]);
    expect(employees[0]).toMatchObject({
      title: 'Engineering',
      team: 'Engineering',
      seniority: 'mid',
      languages: ['en'],
      tenureMonths: 0,
      interests: [],
    });
  });

  it('skips the bad row and keeps the rest', () => {
    // The failure that matters: one malformed line out of ten thousand must not
    // leave a company with no directory at all.
    const { employees, skipped } = readDirectoryCsv(
      [
        HEADER,
        'e1,Ada Lovelace,ada@acme.com,Engineer,senior,Engineering,Eng/Core,IST-HQ,en,10,',
        ',No Id,noid@acme.com,Analyst,mid,Risk,Risk,IST-HQ,en,1,',
        'e3,Grace Hopper,grace@acme.com,Engineer,senior,Engineering,Eng/Core,IST-HQ,en,20,',
      ].join('\n'),
    );

    expect(employees.map((e) => e.id)).toEqual(['e1', 'e3']);
    expect(skipped).toEqual([{ line: 3, reason: 'missing employee_id' }]);
  });

  it('names the line the way a spreadsheet does', () => {
    const { skipped } = readDirectoryCsv(`${HEADER}\ne1,Ada Lovelace,,,,,,,,,`);
    expect(skipped[0]?.line).toBe(2);
  });

  it('ignores a blank line rather than reporting it as a broken record', () => {
    // Exports end with one, and a trailing newline is not a person anybody
    // needs to be told about.
    const { employees, skipped } = readDirectoryCsv(
      `employee_id,display_name,email,department,office_id\ne1,Ada,ada@acme.com,Eng,IST-HQ\n\n`,
    );

    expect(employees).toHaveLength(1);
    expect(skipped).toEqual([]);
  });

  it('refuses a second row for the same person', () => {
    // Two rows would be two seats at two tables.
    const { employees, skipped } = readDirectoryCsv(
      [
        'employee_id,display_name,email,department,office_id',
        'e1,Ada Lovelace,ada@acme.com,Engineering,IST-HQ',
        'e1,Ada Lovelace,ada.l@acme.com,Engineering,IST-HQ',
      ].join('\n'),
    );

    expect(employees).toHaveLength(1);
    expect(skipped).toEqual([{ line: 3, reason: 'duplicate employee_id e1' }]);
  });

  it('says so when a seniority is not on the ladder, rather than guessing', () => {
    // Silently defaulting would put a director on the junior end of every
    // spread and nobody would ever find out why.
    const { employees, skipped } = readDirectoryCsv(
      `${HEADER}\ne1,Ada Lovelace,ada@acme.com,Engineer,VP,Engineering,Eng,IST-HQ,en,10,`,
    );

    expect(employees).toEqual([]);
    expect(skipped[0]?.reason).toContain('unknown seniority "VP"');
    expect(skipped[0]?.reason).toContain('intern, junior, mid, senior, lead, manager, director');
  });

  it('takes the ladder in whatever case the export writes it', () => {
    const { employees } = readDirectoryCsv(
      `${HEADER}\ne1,Ada Lovelace,ada@acme.com,Engineer, Senior ,Engineering,Eng,IST-HQ,en,10,`,
    );
    expect(employees[0]?.seniority).toBe('senior');
  });

  it('reads the column names an export actually uses', () => {
    const { employees } = readDirectoryCsv(
      'PersonnelNo,FullName,WorkEmail,Dept,Site\n7781,Ada Lovelace,ada@acme.com,Engineering,IST-HQ',
      {
        id: 'PersonnelNo',
        displayName: 'FullName',
        email: 'WorkEmail',
        department: 'Dept',
        officeId: 'Site',
      },
    );

    expect(employees[0]).toMatchObject({ id: '7781', officeId: 'IST-HQ' });
  });

  it('ignores a tenure that is not a number, rather than producing NaN', () => {
    const { employees } = readDirectoryCsv(
      `${HEADER}\ne1,Ada Lovelace,ada@acme.com,Engineer,mid,Engineering,Eng,IST-HQ,en,n/a,`,
    );
    expect(employees[0]?.tenureMonths).toBe(0);
  });

  it('survives an empty file without pretending it worked', () => {
    expect(readDirectoryCsv('')).toEqual({ employees: [], skipped: [] });
    expect(readDirectoryCsv(HEADER)).toEqual({ employees: [], skipped: [] });
  });

  it('reports every skipped row to the caller instead of throwing', async () => {
    const problems: unknown[] = [];
    const directory = new CsvDirectory({
      load: async () => `${HEADER}\ne1,Ada Lovelace,,,,,,,,,`,
      onSkipped: (problem) => problems.push(problem),
    });

    await expect(directory.listEmployees()).resolves.toEqual([]);
    expect(problems).toHaveLength(1);
  });
});

describe('a store built on a directory', () => {
  it('matches the people the directory gave it, whoever they are', async () => {
    // The point of the seam: nothing below the store can tell a CSV from a
    // fixture from a company's real export.
    const store = new SqliteStore({
      path: ':memory:',
      directory: new CsvDirectory({
        load: async () =>
          [
            'employee_id,display_name,email,department,office_id',
            'e1,Ada Lovelace,ada@acme.com,Engineering,IST-HQ',
            'e2,Grace Hopper,grace@acme.com,Risk,IST-HQ',
          ].join('\n'),
      }),
      offices: [
        {
          id: 'IST-HQ',
          displayName: 'Istanbul HQ',
          timeZone: 'Europe/Istanbul',
          meetingPoint: 'Cafeteria',
        },
      ],
      attendance: new ManualAttendanceProvider([]),
    });

    expect((await store.listEmployees()).map((e) => e.displayName)).toEqual([
      'Ada Lovelace',
      'Grace Hopper',
    ]);
    expect((await store.getEmployee('e2'))?.department).toBe('Risk');
    store.close();
  });

  it('reads the directory once, not once per lookup', async () => {
    // Every page calls getEmployee. A directory is a file read or an HTTP call,
    // so doing it per lookup would turn one page into hundreds.
    let reads = 0;
    const store = new SqliteStore({
      path: ':memory:',
      directory: {
        name: 'counting',
        listEmployees: async () => {
          reads++;
          return [];
        },
      },
      offices: [],
      attendance: new ManualAttendanceProvider([]),
    });

    await store.listEmployees();
    await store.getEmployee('e1');
    await store.listEmployees();

    expect(reads).toBe(1);
    store.close();
  });

  it('hands a static list through unchanged', async () => {
    const directory = staticDirectory([
      {
        id: 'e1',
        displayName: 'Ada Lovelace',
        email: 'ada@acme.com',
        title: 'Engineer',
        seniority: 'senior',
        department: 'Engineering',
        team: 'Eng',
        officeId: 'IST-HQ',
        languages: ['en'],
        tenureMonths: 10,
        interests: [],
      },
    ]);

    expect((await directory.listEmployees())[0]?.id).toBe('e1');
  });
});

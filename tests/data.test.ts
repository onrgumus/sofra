import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, officeFixture, person, seedBasics, type TestDb } from './support/db';
import { createPerson, findPerson, listPeople, saveProfile } from '../src/data/people';
import { getOffice, listHolidays, addHoliday, updateOffice } from '../src/data/offices';
import {
  addDepartment,
  isDomainAllowed,
  listDepartments,
  removeDepartment,
} from '../src/data/settings';
import {
  cancelRequest,
  intentsFor,
  requestsForDay,
  setPattern,
  setRequest,
} from '../src/data/lunch';
import { claimScheduled, finishRun, listRuns } from '../src/data/jobs';
import { hitRateLimit } from '../src/data/sessions';

let t: TestDb;

beforeAll(async () => {
  t = await createTestDb();
  await seedBasics(t.db);
});
afterAll(async () => t.cleanup());

describe('the schema', () => {
  it('migrates an empty database and keeps an office as it was saved', async () => {
    const office = await getOffice(t.db, 'IST');
    expect(office).toMatchObject({
      timeZone: 'Europe/Istanbul',
      opensAt: '09:00',
      lunchSlots: ['12:00'],
    });

    await updateOffice(t.db, { ...office!, lunchSlots: ['12:30', '12:00'], matchLeadMinutes: 150 });
    expect(await getOffice(t.db, 'IST')).toMatchObject({
      lunchSlots: ['12:00', '12:30'],
      matchLeadMinutes: 150,
    });
    await updateOffice(t.db, office!);
  });

  it('refuses an office timetable that is not a time', async () => {
    const office = (await getOffice(t.db, 'IST'))!;
    await expect(updateOffice(t.db, { ...office, opensAt: '25:00' })).rejects.toThrow();
  });

  it('returns a date as the day it is, not a timestamp', async () => {
    await addHoliday(t.db, { officeId: 'IST', date: '2026-10-29', name: 'Cumhuriyet Bayramı' });
    expect(await listHolidays(t.db, 'IST')).toEqual([
      { officeId: 'IST', date: '2026-10-29', name: 'Cumhuriyet Bayramı' },
    ]);
  });
});

describe('settings', () => {
  it('allows exact domains only', async () => {
    expect(await isDomainAllowed(t.db, 'Someone@ACME.test')).toBe(true);
    expect(await isDomainAllowed(t.db, 'someone@evil.acme.test')).toBe(false);
    expect(await isDomainAllowed(t.db, 'someone@acme.test.evil.com')).toBe(false);
    expect(await isDomainAllowed(t.db, 'not-an-address')).toBe(false);
  });

  it('keeps one department per name, whatever the capitals', async () => {
    expect(await addDepartment(t.db, '  engineering ')).toBe('Engineering');
    expect((await listDepartments(t.db)).filter((d) => d === 'Engineering')).toHaveLength(1);
  });

  it('will not remove a department somebody is in', async () => {
    await person(t.db, 900, { department: 'Legal' });
    expect(await removeDepartment(t.db, 'Legal')).toBe(false);
    await addDepartment(t.db, 'Temporary');
    expect(await removeDepartment(t.db, 'Temporary')).toBe(true);
  });
});

describe('people', () => {
  it('finds somebody by object id first, then address, then alias', async () => {
    const a = await createPerson(t.db, {
      email: 'Onur.Gumus@acme.test',
      source: 'self',
      aliases: ['ogumus@acme.onmicrosoft.com'],
      entraObjectId: 'oid-onur',
    });
    expect(a.email).toBe('onur.gumus@acme.test');
    expect((await findPerson(t.db, { entraObjectId: 'oid-onur' }))?.id).toBe(a.id);
    expect((await findPerson(t.db, { addresses: ['ONUR.GUMUS@acme.test'] }))?.id).toBe(a.id);
    expect((await findPerson(t.db, { addresses: ['ogumus@acme.onmicrosoft.com'] }))?.id).toBe(a.id);
    expect(await findPerson(t.db, { addresses: ['nobody@acme.test'] })).toBeNull();
  });

  it('refuses a second person with the same address', async () => {
    await createPerson(t.db, { email: 'twice@acme.test', source: 'self' });
    await expect(
      createPerson(t.db, { email: 'TWICE@acme.test', source: 'self' }),
    ).rejects.toThrow();
  });

  it('becomes onboarded when the profile is first saved', async () => {
    const fresh = await createPerson(t.db, { email: 'new@acme.test', source: 'self' });
    expect(fresh.onboardedAt).toBeNull();
    const saved = await saveProfile(t.db, fresh.id, {
      displayName: 'New Person',
      title: 'Analyst',
      department: 'Finance',
      team: 'FP&A',
      seniority: 'junior',
      officeId: 'IST',
      languages: ['tr', 'en'],
      interests: ['chess'],
      startedOn: '2024-01-01',
    });
    expect(saved.onboardedAt).not.toBeNull();
    expect(saved.languages).toEqual(['tr', 'en']);
  });

  it('searches without treating % as a wildcard', async () => {
    expect(await listPeople(t.db, { search: '%' })).toEqual([]);
    expect((await listPeople(t.db, { search: 'new person' })).map((p) => p.email)).toEqual([
      'new@acme.test',
    ]);
  });
});

describe('lunch requests', () => {
  it('expands a weekly pattern, and a skipped week stays skipped', async () => {
    const p = await person(t.db, 1);
    // 2026-10-06 is a Tuesday.
    await setPattern(t.db, { employeeId: p.id, weekdays: [2, 4], slot: null });

    expect((await requestsForDay(t.db, 'IST', '2026-10-06')).map((r) => r.employeeId)).toContain(
      p.id,
    );
    expect(
      (await requestsForDay(t.db, 'IST', '2026-10-07')).map((r) => r.employeeId),
    ).not.toContain(p.id);

    await cancelRequest(t.db, p.id, '2026-10-06');
    expect(
      (await requestsForDay(t.db, 'IST', '2026-10-06')).map((r) => r.employeeId),
    ).not.toContain(p.id);

    const intents = await intentsFor(t.db, p, ['2026-10-06', '2026-10-08']);
    expect(intents.get('2026-10-06')).toMatchObject({ request: null, skipped: true });
    expect(intents.get('2026-10-08')?.request).toMatchObject({ source: 'weekly', officeId: 'IST' });

    // Asking for the day again undoes the skip.
    await setRequest(t.db, {
      employeeId: p.id,
      date: '2026-10-06',
      officeId: 'IST',
      slot: null,
      source: 'manual',
    });
    expect((await intentsFor(t.db, p, ['2026-10-06'])).get('2026-10-06')?.skipped).toBe(false);
  });

  it('lets a newly added weekday override an old one-off skip, but keeps a skipped week', async () => {
    const p = await person(t.db, 2);
    const tuesday = '2030-01-08';
    const thursday = '2030-01-10';
    // A one-off request dropped before there was any pattern.
    await setRequest(t.db, {
      employeeId: p.id,
      date: tuesday,
      officeId: 'IST',
      slot: null,
      source: 'manual',
    });
    await cancelRequest(t.db, p.id, tuesday);

    await setPattern(t.db, { employeeId: p.id, weekdays: [2], slot: null });
    expect((await intentsFor(t.db, p, [tuesday])).get(tuesday)?.request).toMatchObject({
      source: 'weekly',
    });

    // Skipping a week of the pattern sticks, even when another day is added.
    await cancelRequest(t.db, p.id, tuesday);
    await setPattern(t.db, { employeeId: p.id, weekdays: [2, 4], slot: null });
    const intents = await intentsFor(t.db, p, [tuesday, thursday]);
    expect(intents.get(tuesday)).toMatchObject({ request: null, skipped: true });
    expect(intents.get(thursday)?.request).toMatchObject({ source: 'weekly' });
  });

  it('does not count somebody who has not finished their profile', async () => {
    const half = await createPerson(t.db, {
      email: 'half@acme.test',
      source: 'self',
      officeId: 'IST',
    });
    await setRequest(t.db, {
      employeeId: half.id,
      date: '2026-10-09',
      officeId: 'IST',
      slot: null,
      source: 'manual',
    });
    expect(
      (await requestsForDay(t.db, 'IST', '2026-10-09')).map((r) => r.employeeId),
    ).not.toContain(half.id);
  });
});

describe('scheduled jobs', () => {
  it('runs once however many ticks ask for it, and retries a failure a few times', async () => {
    const job = { kind: 'match' as const, officeId: 'IST', runKey: '2026-10-12' };
    const first = await claimScheduled(t.db, job);
    expect(first).not.toBeNull();
    expect(await claimScheduled(t.db, job)).toBeNull();

    await finishRun(t.db, first!, { status: 'failed', error: 'boom' });
    const retry = await claimScheduled(t.db, job);
    expect(retry).toBe(first);
    await finishRun(t.db, retry!, { status: 'done', summary: { tables: 2 } });
    expect(await claimScheduled(t.db, job)).toBeNull();

    const runs = await listRuns(t.db, { officeId: 'IST' });
    expect(runs[0]).toMatchObject({ status: 'done', attempts: 2, summary: { tables: 2 } });
  });

  it('lets exactly one of many simultaneous ticks claim a job', async () => {
    const job = { kind: 'match' as const, officeId: 'IST', runKey: '2026-10-13' };
    const claims = await Promise.all(Array.from({ length: 8 }, () => claimScheduled(t.db, job)));
    expect(claims.filter((c) => c !== null)).toHaveLength(1);
  });
});

describe('rate limits', () => {
  it('counts per key within the window', async () => {
    const results = [];
    for (let i = 0; i < 4; i++) results.push(await hitRateLimit(t.db, 'login:x@acme.test', 3, 60));
    expect(results).toEqual([true, true, true, false]);
    expect(await hitRateLimit(t.db, 'login:y@acme.test', 3, 60)).toBe(true);
  });
});

describe('fixtures', () => {
  it('builds the default office', () => {
    expect(officeFixture().id).toBe('IST');
  });
});

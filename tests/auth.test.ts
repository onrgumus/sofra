import { describe, expect, it } from 'vitest';
import {
  checkPassword,
  createSessionValue,
  readSessionValue,
  DEMO_PASSWORD,
} from '../src/lib/auth';
import { DemoStore } from '../src/store/demo';
import { DEMO_USERNAME, FEATURED_EMPLOYEE, pickRandomColleague } from '../src/store/featured';

describe('checkPassword', () => {
  it('accepts the demo password', async () => {
    expect(checkPassword(DEMO_PASSWORD)).toBe(true);
  });

  it('rejects anything else, including a prefix of the real one', async () => {
    for (const wrong of ['', '123', '12345', '1234 ', 'onur', 'Password1']) {
      expect(checkPassword(wrong)).toBe(false);
    }
  });
});

describe('session cookies', () => {
  it('round-trips the employee it was issued for', async () => {
    const cookie = createSessionValue('onur');
    expect(readSessionValue(cookie)).toBe('onur');
  });

  it('cannot be forged by writing an employee id into devtools', async () => {
    // The whole point of signing: an unsigned or mis-signed value is not a
    // session, so you cannot become a colleague by editing a cookie.
    expect(readSessionValue('e0042')).toBeNull();
    expect(readSessionValue('e0042.')).toBeNull();
    expect(readSessionValue('e0042.notasignature')).toBeNull();
  });

  it('rejects a signature lifted from another account', async () => {
    const stolen = createSessionValue('onur').split('.')[1]!;
    expect(readSessionValue(`e0042.${stolen}`)).toBeNull();
  });

  it('treats a missing cookie as signed out', async () => {
    expect(readSessionValue(undefined)).toBeNull();
    expect(readSessionValue('')).toBeNull();
  });
});

describe('the demo account', () => {
  const store = new DemoStore(7, 160);

  it('is a real colleague in the seeded company', async () => {
    const onur = (await store.getEmployee(DEMO_USERNAME))!;
    expect(onur).toBeDefined();
    expect(onur.displayName).toBe('Onur GG');
    expect(onur.title).toBe('AI Digital Transformation Manager');
    expect(onur.officeId).toBe('IST-HQ');
  });

  it('is listed with everyone else, so the matcher can seat him', async () => {
    expect((await store.listEmployees('IST-HQ')).map((e) => e.id)).toContain(FEATURED_EMPLOYEE.id);
  });

  it('does not displace anyone — the company is still the requested size', async () => {
    expect(await store.listEmployees()).toHaveLength(160);
  });

  it('has a unique name like everyone else', async () => {
    const names = (await store.listEmployees()).map((e) => e.displayName);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe('pickRandomColleague', () => {
  const store = new DemoStore(7, 160);

  it('never hands out the shared demo account', async () => {
    // The whole reason it exists: several people on one link should not all end
    // up ticking the same boxes as Onur GG.
    for (const r of [0, 0.25, 0.5, 0.75, 0.999999]) {
      expect((await pickRandomColleague(store, () => r)).id).not.toBe(FEATURED_EMPLOYEE.id);
    }
  });

  it('stays in range at both ends', async () => {
    const colleagues = (await store.listEmployees()).filter((e) => e.id !== FEATURED_EMPLOYEE.id);
    expect((await pickRandomColleague(store, () => 0)).id).toBe(colleagues[0]!.id);
    expect((await pickRandomColleague(store, () => 0.999999)).id).toBe(colleagues.at(-1)!.id);
  });

  it('spreads people out rather than returning the same one', async () => {
    const picks = new Set(
      await Promise.all(
        Array.from(
          { length: 40 },
          async (_, i) => (await pickRandomColleague(store, () => i / 40)).id,
        ),
      ),
    );
    expect(picks.size).toBeGreaterThan(30);
  });

  it('falls back to the demo account when there is nobody else', async () => {
    const lonely = { listEmployees: async () => [FEATURED_EMPLOYEE] } as unknown as DemoStore;
    expect((await pickRandomColleague(lonely)).id).toBe(FEATURED_EMPLOYEE.id);
  });
});

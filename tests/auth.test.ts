import { describe, expect, it } from 'vitest';
import {
  checkPassword,
  createSessionValue,
  readSessionValue,
  DEMO_PASSWORD,
} from '../src/lib/auth';
import { DemoStore } from '../src/store/demo';
import { DEMO_USERNAME, FEATURED_EMPLOYEE } from '../src/store/featured';

describe('checkPassword', () => {
  it('accepts the demo password', () => {
    expect(checkPassword(DEMO_PASSWORD)).toBe(true);
  });

  it('rejects anything else, including a prefix of the real one', () => {
    for (const wrong of ['', '123', '12345', '1234 ', 'onur', 'Password1']) {
      expect(checkPassword(wrong)).toBe(false);
    }
  });
});

describe('session cookies', () => {
  it('round-trips the employee it was issued for', () => {
    const cookie = createSessionValue('onur');
    expect(readSessionValue(cookie)).toBe('onur');
  });

  it('cannot be forged by writing an employee id into devtools', () => {
    // The whole point of signing: an unsigned or mis-signed value is not a
    // session, so you cannot become a colleague by editing a cookie.
    expect(readSessionValue('e0042')).toBeNull();
    expect(readSessionValue('e0042.')).toBeNull();
    expect(readSessionValue('e0042.notasignature')).toBeNull();
  });

  it('rejects a signature lifted from another account', () => {
    const stolen = createSessionValue('onur').split('.')[1]!;
    expect(readSessionValue(`e0042.${stolen}`)).toBeNull();
  });

  it('treats a missing cookie as signed out', () => {
    expect(readSessionValue(undefined)).toBeNull();
    expect(readSessionValue('')).toBeNull();
  });
});

describe('the demo account', () => {
  const store = new DemoStore(7, 160);

  it('is a real colleague in the seeded company', () => {
    const onur = store.getEmployee(DEMO_USERNAME)!;
    expect(onur).toBeDefined();
    expect(onur.displayName).toBe('Onur GG');
    expect(onur.title).toBe('AI Digital Transformation Manager');
    expect(onur.officeId).toBe('IST-HQ');
  });

  it('is listed with everyone else, so the matcher can seat him', () => {
    expect(store.listEmployees('IST-HQ').map((e) => e.id)).toContain(FEATURED_EMPLOYEE.id);
  });

  it('does not displace anyone — the company is still the requested size', () => {
    expect(store.listEmployees()).toHaveLength(160);
  });

  it('has a unique name like everyone else', () => {
    const names = store.listEmployees().map((e) => e.displayName);
    expect(new Set(names).size).toBe(names.length);
  });
});

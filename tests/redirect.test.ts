import { describe, expect, it } from 'vitest';
import { safeRedirectPath } from '../src/lib/redirect';

const NEWLINE = String.fromCharCode(10);
const CARRIAGE_RETURN = String.fromCharCode(13);
const NUL = String.fromCharCode(0);

describe('safeRedirectPath', () => {
  it('keeps an ordinary path on this site', () => {
    expect(safeRedirectPath('/admin')).toBe('/admin');
    expect(safeRedirectPath('/c/2026-09-15-IST-HQ-12:00-1')).toBe('/c/2026-09-15-IST-HQ-12:00-1');
    expect(safeRedirectPath('/admin?date=2026-09-15')).toBe('/admin?date=2026-09-15');
  });

  it('refuses a protocol-relative URL, which is the one that looks safe', () => {
    // "//evil.example" passes a startsWith('/') check and a browser reads it as
    // https://evil.example. The victim sees a legitimate domain in the link
    // they were sent, signs in, and lands somewhere else entirely.
    expect(safeRedirectPath('//evil.example')).toBe('/');
    expect(safeRedirectPath('//evil.example/owned')).toBe('/');
  });

  it('refuses the backslash variant browsers also follow off-site', () => {
    expect(safeRedirectPath('/\\evil.example')).toBe('/');
  });

  it('refuses an absolute URL', () => {
    for (const url of ['https://evil.example', 'http://evil.example', 'javascript:alert(1)']) {
      expect(safeRedirectPath(url)).toBe('/');
    }
  });

  it('refuses control characters, which can split a URL', () => {
    expect(safeRedirectPath(`/admin${NEWLINE}Location: https://evil.example`)).toBe('/');
    expect(safeRedirectPath(`/admin${CARRIAGE_RETURN}${NEWLINE}Set-Cookie: x=1`)).toBe('/');
    expect(safeRedirectPath(`/admin${NUL}`)).toBe('/');
  });

  it('refuses anything that is not a string, or is empty', () => {
    for (const value of [undefined, null, '', 42, {}, []]) {
      expect(safeRedirectPath(value)).toBe('/');
    }
  });

  it('refuses a relative path that could climb out', () => {
    expect(safeRedirectPath('../../etc/passwd')).toBe('/');
    expect(safeRedirectPath('admin')).toBe('/');
  });

  it('honours a caller-supplied fallback', () => {
    expect(safeRedirectPath('//evil.example', '/login')).toBe('/login');
  });
});

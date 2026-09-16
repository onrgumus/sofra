import { createHmac, timingSafeEqual } from 'node:crypto';
import { envOptional, envText } from './env';

/**
 * A demo gate, not authentication.
 *
 * One shared password lets anyone with the link try the product. That is the
 * point here and it is nobody's idea of a security boundary. Real sign-in
 * replaces this file and `src/lib/session.ts` together. What it does do is stop
 * a session cookie being forged by hand: the employee id is signed, so you
 * cannot become a colleague by editing a cookie in devtools.
 */
export const DEMO_PASSWORD = envText('SOFRA_DEMO_PASSWORD', '1234');

/**
 * The fallback is fine on a laptop and a hole in public.
 *
 * It is published in this repository, so a deployment that forgets to set its
 * own means anyone who has read the source can compute a valid cookie for any
 * employee id and sign in as them without the password. Running insecurely and
 * quietly is the worst of the three options, so production refuses to boot.
 */
const DEVELOPMENT_SECRET = 'sofra-demo-secret-change-me-in-production';

function sessionSecret(): string {
  const configured = envOptional('SOFRA_SESSION_SECRET');
  if (configured && configured !== DEVELOPMENT_SECRET) return configured;

  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'SOFRA_SESSION_SECRET is not set. The fallback is published in the repository, so ' +
        'without your own value anyone can forge a session cookie. Set it to a long random ' +
        'string and redeploy.',
    );
  }
  return DEVELOPMENT_SECRET;
}

export function checkPassword(candidate: string): boolean {
  const expected = Buffer.from(DEMO_PASSWORD, 'utf8');
  const actual = Buffer.from(candidate, 'utf8');
  // Compare in constant time, and only when the lengths already match;
  // timingSafeEqual throws on a length mismatch.
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function sign(value: string): string {
  return createHmac('sha256', sessionSecret()).update(value).digest('base64url');
}

export function createSessionValue(employeeId: string): string {
  return `${employeeId}.${sign(employeeId)}`;
}

/** Returns the employee id the cookie vouches for, or null if it does not. */
export function readSessionValue(cookieValue: string | undefined): string | null {
  if (!cookieValue) return null;

  const separator = cookieValue.lastIndexOf('.');
  if (separator <= 0) return null;

  const employeeId = cookieValue.slice(0, separator);
  const signature = cookieValue.slice(separator + 1);
  const expected = sign(employeeId);

  if (signature.length !== expected.length) return null;
  return timingSafeEqual(Buffer.from(signature), Buffer.from(expected)) ? employeeId : null;
}

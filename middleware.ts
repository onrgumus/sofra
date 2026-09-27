import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE } from './src/lib/session-cookie';

/** Pages anybody may open: signing in, and what the scheduler, Teams and health checks call. */
const PUBLIC = ['/login', '/api/', '/dev/mailbox'];

/**
 * Sends anyone without a session cookie to the sign-in page, and tells the
 * server which page was asked for, so a sign-in comes back to it.
 *
 * Presence only. Whether the session is real, unexpired and belongs to an
 * active person is decided on the server, against the database; this is the
 * Edge runtime and has neither.
 */
export function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const headers = new Headers(request.headers);
  headers.set('x-sofra-path', pathname + search);

  if (PUBLIC.some((p) => pathname.startsWith(p)) || request.cookies.has(SESSION_COOKIE)) {
    return NextResponse.next({ request: { headers } });
  }

  const login = new URL('/login', request.url);
  if (pathname !== '/' || search) login.searchParams.set('next', pathname + search);
  return NextResponse.redirect(login);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icon.svg).*)'],
};

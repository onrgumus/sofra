import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE } from './src/lib/session-cookie';

/**
 * Sends anyone without a session to the sign-in page.
 *
 * Presence only — the cookie's signature is verified on the server, where the
 * secret lives. The cron endpoint carries its own bearer token and is left
 * alone.
 */
export function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  if (pathname.startsWith('/login') || pathname.startsWith('/api/')) {
    return NextResponse.next();
  }
  if (request.cookies.has(SESSION_COOKIE)) {
    return NextResponse.next();
  }

  const login = new URL('/login', request.url);
  if (pathname !== '/') login.searchParams.set('next', pathname + search);
  return NextResponse.redirect(login);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};

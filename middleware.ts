import { NextResponse, type NextRequest } from 'next/server';
import { SEAT_COOKIE } from './src/lib/session';

/**
 * Hands each new visitor a seat number, so the demo opens as a different
 * colleague for different people rather than everyone sharing one account.
 */
export function middleware(request: NextRequest) {
  const response = NextResponse.next();
  if (request.cookies.has(SEAT_COOKIE)) return response;

  response.cookies.set(SEAT_COOKIE, String(Math.floor(Math.random() * 100_000)), {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
  });
  return response;
}

export const config = {
  // Everything except Next's own assets.
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};

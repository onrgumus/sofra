/**
 * Where a sign-in may send someone afterwards.
 *
 * `next.startsWith('/')` is the obvious check and it is not enough: "//evil.com"
 * starts with a slash and a browser reads it as a protocol-relative URL, so the
 * victim sees a legitimate domain in the link they were sent, signs in, and
 * lands on somebody else's page. "/\evil.com" does the same in several
 * browsers. Anything that is not a plain path on this site becomes the home
 * page.
 */
export function safeRedirectPath(next: unknown, fallback = '/'): string {
  if (typeof next !== 'string' || next === '') return fallback;
  if (!next.startsWith('/')) return fallback;

  // Protocol-relative and backslash variants both leave the site.
  if (next.startsWith('//') || next.startsWith('/\\')) return fallback;

  // Control characters can split a URL or smuggle a second header.
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(next)) return fallback;

  return next;
}

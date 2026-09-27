/**
 * Teams renders a tab in an iframe on its own domain, so the app has to say who
 * is allowed to frame it. Listing the hosts explicitly, rather than leaving it
 * open, keeps Sofra out of anybody else's page, which is what stops a page
 * elsewhere from framing the console and tricking an admin into clicking.
 */
const TEAMS_FRAME_ANCESTORS = [
  "'self'",
  'https://teams.microsoft.com',
  'https://*.teams.microsoft.com',
  'https://teams.cloud.microsoft',
  'https://*.cloud.microsoft',
  'https://*.skype.com',
  'https://*.microsoft.com',
  'https://*.office.com',
].join(' ');

const production = process.env.NODE_ENV === 'production';

/** @type {import('next').NextConfig} */
export default {
  // No reason to tell every caller which framework and version to look up CVEs for.
  poweredByHeader: false,
  experimental: {
    // The matching engine lives outside app/, so let the server bundle reach it.
    externalDir: true,
  },
  // Node libraries with optional native parts; bundling them only produces warnings.
  serverExternalPackages: ['pg', 'nodemailer'],
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: `frame-ancestors ${TEAMS_FRAME_ANCESTORS}` },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          // Nothing here needs a camera, a microphone or a location.
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
          // Once a browser has seen the site over HTTPS it never tries HTTP, so a
          // session cookie is never offered to a network in between.
          ...(production
            ? [{ key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' }]
            : []),
        ],
      },
      {
        // Sign-in links and pages that show one: never cached, never in history
        // shared with anybody else.
        source: '/login/:path*',
        headers: [{ key: 'Cache-Control', value: 'no-store' }],
      },
    ];
  },
};

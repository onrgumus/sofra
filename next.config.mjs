/**
 * Teams renders a tab in an iframe on its own domain, so the app has to say who
 * is allowed to frame it. Listing the hosts explicitly, rather than leaving it
 * open, keeps Sofra out of anybody else's page.
 */
const TEAMS_FRAME_ANCESTORS = [
  "'self'",
  'https://teams.microsoft.com',
  'https://*.teams.microsoft.com',
  'https://*.skype.com',
  'https://*.microsoft.com',
].join(' ');

/** @type {import('next').NextConfig} */
export default {
  // No reason to tell every caller which framework and version to look up CVEs for.
  poweredByHeader: false,
  experimental: {
    // The matching engine lives outside app/, so let the server bundle reach it.
    externalDir: true,
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: `frame-ancestors ${TEAMS_FRAME_ANCESTORS}` },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        ],
      },
    ];
  },
};

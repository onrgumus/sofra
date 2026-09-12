/** @type {import('next').NextConfig} */
export default {
  experimental: {
    // The matching engine lives outside app/, so let the server bundle reach it.
    externalDir: true,
  },
};

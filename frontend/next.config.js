const withPWA = require("next-pwa")({
  dest: "public",
  register: true,
  skipWaiting: true,
  // Don't try to generate a service worker during local `next dev` — it
  // just adds noise and can serve stale cached files while you're coding.
  disable: process.env.NODE_ENV === "development",
  // If the app is offline and a page isn't cached yet, fall back to the
  // last-visited dashboard shell instead of a browser error page.
  fallbacks: {
    document: "/offline.html",
  },
  runtimeCaching: [
    {
      // Never cache API calls — exam data must always be fresh/live.
      urlPattern: /^https?:\/\/.*\/api\/.*/,
      handler: "NetworkOnly",
      options: {},
    },
    {
      urlPattern: /^https?:\/\/.*\.(?:png|jpg|jpeg|svg|gif|webp|ico)$/,
      handler: "CacheFirst",
      options: {
        cacheName: "images",
        expiration: { maxEntries: 100, maxAgeSeconds: 30 * 24 * 60 * 60 },
      },
    },
    {
      urlPattern: /^https?:\/\/.*\/_next\/static\/.*/,
      handler: "CacheFirst",
      options: {
        cacheName: "next-static",
        expiration: { maxEntries: 200, maxAgeSeconds: 30 * 24 * 60 * 60 },
      },
    },
    {
      urlPattern: /^https?:\/\/.*$/,
      handler: "NetworkFirst",
      options: {
        cacheName: "pages",
        networkTimeoutSeconds: 10,
        expiration: { maxEntries: 50, maxAgeSeconds: 24 * 60 * 60 },
      },
    },
  ],
});

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
};

module.exports = withPWA(nextConfig);

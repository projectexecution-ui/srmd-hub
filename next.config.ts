import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // @resvg/resvg-js ships a native .node binding that Turbopack can't bundle
  // into an ESM chunk ("non-ecmascript placeable asset"). Marking it external
  // keeps it as a runtime require() in the server bundle.
  serverExternalPackages: ['@resvg/resvg-js'],
  // The bills-pipeline card renderer reads a bundled TTF at runtime. Next's
  // file tracer can't see the fs.readFile path, so force-include the font in
  // the route's serverless bundle (Vercel has no system fonts to fall back on).
  outputFileTracingIncludes: {
    '/api/cron/bills-pipeline': ['./lib/bills-pipeline/fonts/**'],
    // The bills-pipeline "Push today" share card reuses the resvg renderer + TTF.
    '/api/bills-pipeline/push-card': ['./lib/bills-pipeline/fonts/**'],
    // The daily bills digest (email + Telegram cards, "send me a test" / to-heads)
    // renders per-project cards with the same resvg renderer + TTF.
    '/api/cron/bills-digest': ['./lib/bills-pipeline/fonts/**'],
    // The daily-site-report digest card reuses the same resvg renderer + TTF.
    '/api/daily-site-report/digest': ['./lib/bills-pipeline/fonts/**'],
  },
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'lh3.googleusercontent.com' },
    ],
  },
  // Static asset caching — heavy iframe HTMLs + logos rarely change. Long
  // browser cache + Vercel CDN means second-visit nav is near-instant.
  async headers() {
    const immutable = 'public, max-age=2592000, stale-while-revalidate=86400' // 30d + 1d swr
    const longish   = 'public, max-age=3600, stale-while-revalidate=86400'    // 1h + 1d swr
    return [
      // Logos — basically never change
      { source: '/srmd-icon.png',     headers: [{ key: 'Cache-Control', value: immutable }] },
      { source: '/srmd-logo.svg',     headers: [{ key: 'Cache-Control', value: immutable }] },
      // Embedded vendor HTMLs — change rarely but we want CDN revalidation
      { source: '/indent-tracker.html', headers: [{ key: 'Cache-Control', value: longish }] },
      { source: '/budget-hub.html',     headers: [{ key: 'Cache-Control', value: longish }] },
    ]
  },
}

export default nextConfig

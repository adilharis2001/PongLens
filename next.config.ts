import type { NextConfig } from "next";

// Security headers applied to every route. Intentionally conservative — no
// strict Content-Security-Policy yet, since that needs per-route tuning for
// inline JSON-LD, Supabase, and Vercel Analytics without breaking them.
const securityHeaders = [
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(self), geolocation=(), browsing-topics=()",
  },
];

// Marketing media: the walkthrough videos and every product screenshot. A
// day in the browser cache, then a week of serving the stale copy while a
// fresh one is fetched. Not "immutable": these files are re-captured under
// the same names after UI changes, and a year-long cache would show the
// old screen to anyone who had visited before.
const mediaCache = [
  {
    key: "Cache-Control",
    value: "public, max-age=86400, stale-while-revalidate=604800",
  },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      { source: "/demo/:path*", headers: mediaCache },
      { source: "/showcase/:path*", headers: mediaCache },
      { source: "/learn/:path*.jpg", headers: mediaCache },
      { source: "/img/:path*", headers: mediaCache },
    ];
  },
};

export default nextConfig;

/** @type {import('next').NextConfig} */

const securityHeaders = [
  { key: 'X-Frame-Options',        value: 'DENY' },
  { key: 'X-Content-Type-Options',  value: 'nosniff' },
  { key: 'Referrer-Policy',         value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy',      value: 'camera=(), microphone=(), geolocation=(), payment=()' },
  {
    key: 'Content-Security-Policy',
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline'",
      // canvas-confetti renders through an OffscreenCanvas worker built from a
      // blob: URL. Without this the worker is blocked and the champion
      // celebration fails SILENTLY - the canvas is still created and control is
      // still transferred to it, so nothing errors and nothing draws. The
      // fireworks had never once fired on a deployed build.
      //
      // Narrow on purpose: workers may come from this origin or from a blob the
      // page itself made. No external origin is permitted, and this does not
      // widen script-src for anything else.
      "worker-src 'self' blob:",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com",
      "img-src 'self' data: blob:",
      "connect-src 'self'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "object-src 'none'",
    ].join('; '),
  },
];

const nextConfig = {
  poweredByHeader: false,

  async headers() {
    return [
      { source: '/',       headers: securityHeaders },
      { source: '/:path*', headers: securityHeaders },
    ];
  },

};

module.exports = nextConfig;

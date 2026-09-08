/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  reactStrictMode: true,
  // Don't advertise the framework/version in X-Powered-By: it helps no one
  // and gives attackers a version fingerprint for known CVEs.
  poweredByHeader: false,

  // Security headers applied to every response.
  // NOTE: access-control-allow-origin is intentionally NOT set globally —
  // only /api/health sets it (for external monitoring). This keeps cross-origin
  // reads of API data blocked while the site is framed-proof via frame-ancestors.
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          {
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              // Next.js injects inline hydration scripts; wallet SDKs (Albedo, etc.)
              // may use eval — required for the app to function.
              "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
              // Tailwind + next/font inject inline styles.
              "style-src 'self' 'unsafe-inline'",
              // QR codes render as data: URIs; wallet icons/explorer images are https.
              "img-src 'self' data: blob: https:",
              // next/font self-hosts fonts at build time.
              "font-src 'self' data:",
              // Stellar RPC/Horizon/Friendbot + wallet SDK endpoints (all https/wss).
              "connect-src 'self' https: wss: ws:",
              // Wallet connect popups/iframes (Albedo, xBull, LOBSTR).
              "frame-src 'self' https:",
              "object-src 'none'",
              "base-uri 'self'",
              "form-action 'self'",
              // Clickjacking protection — never allow framing by other origins.
              "frame-ancestors 'self'",
            ].join('; '),
          },
          // Clickjacking protection (legacy header, widely supported).
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          // Force HTTPS: once a client has seen this over TLS it will refuse
          // plaintext for two years. Browsers ignore it on http, so local dev
          // is unaffected.
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
          // Only send origin on same-origin requests; never leak full wallet URLs.
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          // Disable browser features the dApp doesn't need.
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
        ],
      },
    ];
  },
  webpack: (config, { isServer }) => {
    // @stellar/stellar-sdk depends on sodium-native which is a native module.
    // Ignore it on the client side; the SDK handles it gracefully.
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        sodium: false,
        'sodium-native': false,
        'require-addon': false,
        'fs': false,
        'path': false,
        'crypto': false,
      };
    }
    // Suppress webpack warnings from Stellar SDK native addon detection
    config.module = config.module || {};
    config.module.exprContextCritical = false;
    config.ignoreWarnings = [
      ...(config.ignoreWarnings || []),
      { module: /require-addon/ },
      { module: /sodium-native/ },
    ];
    return config;
  },
};

module.exports = nextConfig;


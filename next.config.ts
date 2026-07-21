import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  experimental: {
    serverActions: {
      // Must exceed the 10MB slide-import cap (with headroom for multipart
      // encoding overhead) so uploads reach the action instead of being
      // rejected with "An unexpected response was received from the server."
      bodySizeLimit: "12mb",
    },
  },
  async headers() {
    const securityHeaders = [
      {
        key: "Content-Security-Policy",
        value: [
          "default-src 'self'",
          "script-src 'self' 'unsafe-inline' 'unsafe-eval' blob:",
          "style-src 'self' 'unsafe-inline'",
          "img-src 'self' data: https: blob:",
          "font-src 'self' data:",
          "connect-src 'self' https:",
          "worker-src 'self' blob:",
          "frame-ancestors 'none'",
          "form-action 'self'",
          "base-uri 'self'",
        ].join("; "),
      },
      { key: "Referrer-Policy", value: "same-origin" },
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "X-Frame-Options", value: "DENY" },
      {
        key: "Strict-Transport-Security",
        value: "max-age=31536000; includeSubDomains",
      },
      {
        key: "Permissions-Policy",
        // Allow the camera on our own origin (pupils photograph worksheets);
        // `camera=()` disallowed it everywhere and could blank the capture feed.
        value: "camera=(self), microphone=(), geolocation=(), interest-cohort=()",
      },
    ];

    return [
      {
        // Exclude the sandboxed webpage-activity route so it can set its own
        // (stricter, sandboxed) Content-Security-Policy on the response.
        source: "/((?!api/activity-webpage/).*)",
        headers: securityHeaders,
      },
    ];
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "img.youtube.com",
      },
      {
        protocol: "https",
        hostname: "i.ytimg.com",
      },
    ],
  },
};

export default nextConfig;

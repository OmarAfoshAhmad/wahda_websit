import type { NextConfig } from "next";

const isProduction = process.env.NODE_ENV === "production";

const cspPolicy = [
  "default-src 'self'",
  // Next.js App Router requires unsafe-inline for hydration and React inline styles
  `script-src 'self' blob: 'unsafe-inline' https://www.googletagmanager.com${isProduction ? "" : " 'unsafe-eval'"}`,
  "script-src-attr 'none'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: blob: https://www.google-analytics.com",
  `connect-src 'self' https://www.google-analytics.com https://analytics.google.com https://stats.g.doubleclick.net${isProduction ? "" : " ws: wss:"}`,
  "frame-src 'none'",
  "manifest-src 'self'",
  "worker-src 'self' blob:",
  "frame-ancestors 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
  ...(isProduction ? ["upgrade-insecure-requests"] : []),
].join("; ");

const securityHeaders = [
  { key: "X-DNS-Prefetch-Control", value: "on" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  // تشديد سياسة HSTS وتأمين ملفات الارتباط (CSRF Protection)
  { 
    key: "Strict-Transport-Security", 
    value: "max-age=63072000; includeSubDomains; preload" 
  },
  { key: "X-Permitted-Cross-Domain-Policies", value: "none" },
  { key: "Content-Security-Policy", value: cspPolicy },
];

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  serverExternalPackages: [],
  compiler: {
    removeConsole: isProduction ? {
      exclude: ["error"], // نحتفظ بالأخطاء فقط لأغراض التتبع إذا حدثت مشكلة حرجة
    } : false,
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;

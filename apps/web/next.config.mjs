import { withSentryConfig } from '@sentry/nextjs';

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Transpile workspace packages so they pick up the same compile pipeline as
  // app code.
  transpilePackages: ['@submittal/db', '@submittal/shared'],
  serverExternalPackages: ['sharp', 'pdf-to-img', 'pdfjs-dist'],
  productionBrowserSourceMaps: true,
  experimental: {
    serverActions: { allowedOrigins: ['localhost:3000'] },
  },
  // The workspace packages import sibling modules with `.js` extensions
  // (the ESM-native convention TypeScript ships compiled output for, even
  // though source files are `.ts`). webpack doesn't resolve that mapping by
  // default — this alias tells it `import './foo.js'` also matches `./foo.ts`.
  webpack(config) {
    config.resolve.extensionAlias = {
      ...(config.resolve.extensionAlias ?? {}),
      '.js': ['.ts', '.tsx', '.js'],
      '.mjs': ['.mts', '.mjs'],
    };
    return config;
  },
};

// Phase 6: upload source maps to Sentry on every deploy. The plugin runs only
// when SENTRY_AUTH_TOKEN + SENTRY_ORG + SENTRY_PROJECT_WEB are set in the
// build environment (Vercel project env vars). On local builds without those,
// withSentryConfig still wraps the build but skips the upload step.
const sentryBuildOptions = {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT_WEB,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: !process.env.CI,
  // Hide source maps from the production bundle but still upload them.
  hideSourceMaps: true,
  widenClientFileUpload: true,
  disableLogger: true,
  release: {
    name: process.env.SENTRY_RELEASE ?? process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.GIT_SHA,
  },
};

export default withSentryConfig(nextConfig, sentryBuildOptions);

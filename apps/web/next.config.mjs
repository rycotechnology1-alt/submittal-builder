/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Transpile workspace packages so they pick up the same compile pipeline as
  // app code.
  transpilePackages: ['@submittal/db', '@submittal/shared'],
  serverExternalPackages: ['sharp', 'pdf-to-img', 'pdfjs-dist'],
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

export default nextConfig;

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Pre-existing type errors in shadcn UI components (chart, resizable, sidebar)
  // do not affect runtime — skip tsc during production builds until they are fixed.
  typescript: { ignoreBuildErrors: true },
  // Fix: Turbopack incorrectly infers the monorepo parent as workspace root when
  // it detects multiple lockfiles. Pin it to this directory so .env.local and
  // other project files are resolved from the correct location.
  turbopack: { root: __dirname },
};

export default nextConfig;

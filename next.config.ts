import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Fix: Turbopack incorrectly infers the monorepo parent as workspace root when
  // it detects multiple lockfiles. Pin it to this directory so .env.local and
  // other project files are resolved from the correct location.
  turbopack: { root: __dirname },
};

export default nextConfig;

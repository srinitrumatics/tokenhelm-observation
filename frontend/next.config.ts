import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // The DuckDB binding is a native addon — keep it external so Next never tries to
  // bundle it into the server build. It is only loaded when EVENT_SOURCE=duckdb (T059).
  serverExternalPackages: ["@duckdb/node-api"],
};

export default nextConfig;

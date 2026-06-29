import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Storage drivers are loaded lazily and only for their EVENT_SOURCE — keep them external
  // so Next never tries to bundle them into the server build. @duckdb/node-api is a native
  // addon (EVENT_SOURCE=duckdb); pg is the Postgres driver (EVENT_SOURCE=postgres, v1.4).
  serverExternalPackages: ["@duckdb/node-api", "pg"],
};

export default nextConfig;

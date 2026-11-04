import type { NextConfig } from "next";
const config: NextConfig = {
  agentRules: false,
  output: process.env.NEXT_STANDALONE === "true" ? "standalone" : undefined,
  devIndicators: false,
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  serverExternalPackages: ["@electric-sql/pglite", "pg"],
};
export default config;

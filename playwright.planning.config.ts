import { defineConfig } from "@playwright/test";
import { mkdirSync, mkdtempSync } from "node:fs";
import { resolve, join } from "node:path";
const root = resolve(".data/planning-e2e");
mkdirSync(root, { recursive: true });
process.env.PLANNING_E2E = "true";
process.env.PLANNING_E2E_DIR ??= mkdtempSync(join(root, "run-"));
const directory = process.env.PLANNING_E2E_DIR,
  url = "http://127.0.0.1:3105";
export default defineConfig({
  testDir: "./e2e",
  testMatch: "team-planning.spec.ts",
  globalSetup: "./tests/helpers/planning-browser.ts",
  outputDir: join(directory, "results"),
  workers: 1,
  timeout: 90000,
  use: {
    baseURL: url,
    storageState: join(directory, "pm-storage.json"),
    channel: "chrome",
    viewport: { width: 1440, height: 1050 },
    trace: "retain-on-failure",
    actionTimeout: 10000,
    navigationTimeout: 45000,
  },
  webServer: {
    command:
      "node --use-env-proxy node_modules/next/dist/bin/next start -H 127.0.0.1 -p 3105",
    url,
    reuseExistingServer: false,
    timeout: 60000,
    env: {
      NEXT_DIST_DIR: process.env.PLANNING_NEXT_DIST_DIR ?? ".next-planning-e2e",
      DATABASE_URL: "",
      DATA_DIR: join(directory, "db"),
      DEMO_MODE: "false",
      GITHUB_APP_ID: "",
      GITHUB_APP_PRIVATE_KEY_BASE64: "",
      GITHUB_TOKEN: "",
      GITHUB_ORG: "org",
      APP_URL: url,
      GITHUB_OAUTH_CLIENT_ID: "synthetic-client",
      GITHUB_OAUTH_CLIENT_SECRET: "synthetic-secret",
      TOKEN_ENCRYPTION_KEY: "ab".repeat(32),
      NO_PROXY: "127.0.0.1,localhost,::1",
      no_proxy: "127.0.0.1,localhost,::1",
    },
  },
});

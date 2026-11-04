import { defineConfig } from "@playwright/test";
const url = "http://127.0.0.1:3100";
export default defineConfig({
  testDir: "./e2e",
  workers: 1,
  use: {
    baseURL: url,
    channel: "chrome",
    viewport: { width: 1440, height: 1050 },
  },
  webServer: {
    command:
      "NEXT_DIST_DIR=.next-e2e DEMO_MODE=true DATABASE_URL= GITHUB_ORG= GITHUB_SYNC_SINCE= APP_URL=http://127.0.0.1:3100 next dev -H 127.0.0.1 -p 3100",
    env: { DATA_DIR: process.env.E2E_DATA_DIR ?? "./.data/e2e" },
    url,
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
  },
});

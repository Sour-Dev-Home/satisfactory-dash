import { defineConfig } from "@playwright/test";

// Drives the built Electron app (`npm run e2e` builds first) against the fake server in e2e/fake-server.cjs.
export default defineConfig({
  testDir: "./e2e",
  workers: 1,
  timeout: 60_000,
  forbidOnly: !!process.env.CI,
  reporter: "list",
  use: { trace: "retain-on-failure" },
});

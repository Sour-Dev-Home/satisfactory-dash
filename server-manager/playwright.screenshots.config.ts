import { defineConfig } from "@playwright/test";

// Retakes the portfolio screenshots in docs-vault/wiki/assets/server-manager/ (`npm run screenshots`), against the
// same fakes as the e2e suite, so no real path, save name or player name can appear. Not part of `npm run e2e`.
export default defineConfig({
  testDir: "./screenshots",
  testMatch: "*.shots.ts",
  workers: 1,
  timeout: 90_000,
  reporter: "list",
});

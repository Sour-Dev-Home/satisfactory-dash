import { defineConfig, devices } from "@playwright/test";

// Visual and accessibility checks (ADR-0016 item 5) against the PRODUCTION build, served by
// `vite preview` with the same security headers as the live site (public/_headers), so a
// CSP violation here is one users would hit. The API is mocked per test with page.route().
const PORT = 4173;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  // Pixel baselines are generated in CI's Linux Playwright image, because fonts render
  // differently per OS. Elsewhere, screenshot comparisons are skipped; the rest still runs.
  ignoreSnapshots: !process.env.PLAYWRIGHT_SNAPSHOTS,
  snapshotPathTemplate: "{testDir}/__screenshots__/{projectName}/{arg}{ext}",
  expect: { toHaveScreenshot: { maxDiffPixelRatio: 0.01, animations: "disabled" } },
  use: {
    baseURL: `http://localhost:${PORT}`,
    // Fixed so rendered timestamps and number formats are identical on every machine.
    timezoneId: "UTC",
    locale: "en-US",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
    },
    {
      name: "mobile",
      // Build and guard checks don't depend on the viewport; they run in desktop only.
      testIgnore: /(build-output|guards)\.spec\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 1,
        isMobile: true,
        hasTouch: true,
      },
    },
  ],
  webServer: {
    // VITE_API_URL stays empty, so the app calls same-origin /api, which the tests mock.
    command: `npm run build && npx vite preview --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});

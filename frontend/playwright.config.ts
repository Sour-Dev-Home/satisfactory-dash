import { defineConfig, devices } from "@playwright/test";

// Visual and accessibility checks (ADR-0016 item 5) against the PRODUCTION build, served by
// `vite preview` with the same security headers as the live site (public/_headers), so a
// CSP violation here is one users would hit. The API is mocked per test with page.route().
// e2e/demo/ runs against the DEMO build (ADR-0026), on its own port with demo/_headers.
const PORT = 4173;
const DEMO_PORT = 4174;
const DEMO_URL = `http://localhost:${DEMO_PORT}`;
const DEMO_SPECS = /[\\/]demo[\\/].*\.spec\.ts/;

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
  // Near-strict: baselines and runs come from the same pinned Linux image, but two CI runs of
  // identical code still differed by 16 antialiased pixels (desktop/default.png, #82). 50
  // pixels absorbs that and nothing real: one short line of text is hundreds of pixels. A
  // ratio tolerance (it was 1%, about 13k pixels at 1440x900) let a whole missing line of text
  // pass, and made `--update-snapshots` skip real changes, so keep this an absolute count.
  expect: { toHaveScreenshot: { maxDiffPixels: 50, animations: "disabled" } },
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
      testIgnore: DEMO_SPECS,
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
    },
    {
      name: "mobile",
      // Build and guard checks don't depend on the viewport; they run in desktop only.
      testIgnore: [/(build-output|guards)\.spec\.ts/, DEMO_SPECS],
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 1,
        isMobile: true,
        hasTouch: true,
      },
    },
    {
      name: "demo-desktop",
      testMatch: DEMO_SPECS,
      use: {
        ...devices["Desktop Chrome"],
        baseURL: DEMO_URL,
        viewport: { width: 1440, height: 900 },
        deviceScaleFactor: 1,
      },
    },
    {
      name: "demo-mobile",
      testMatch: DEMO_SPECS,
      use: {
        ...devices["Desktop Chrome"],
        baseURL: DEMO_URL,
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 1,
        isMobile: true,
        hasTouch: true,
      },
    },
  ],
  // Always fresh builds: reusing a server already on either port could test a stale build.
  webServer: [
    {
      // VITE_API_URL stays empty, so the app calls same-origin /api, which the tests mock.
      command: `npm run build && npx vite preview --port ${PORT} --strictPort`,
      url: `http://localhost:${PORT}`,
      reuseExistingServer: false,
      timeout: 180_000,
    },
    {
      // The demo site (dist-demo/), built with the production API URL set (see build-demo.mjs).
      // build-output.spec.ts also reads dist-demo/; every server is up before any test starts.
      command: `node e2e/build-demo.mjs && npx vite preview --mode demo --port ${DEMO_PORT} --strictPort`,
      url: DEMO_URL,
      reuseExistingServer: false,
      timeout: 180_000,
    },
  ],
});

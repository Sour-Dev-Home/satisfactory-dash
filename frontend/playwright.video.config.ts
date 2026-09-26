import { defineConfig, devices } from "@playwright/test";

// `npm run demo:video` (ADR-0026): records the demo walkthrough (e2e/video/walkthrough.video.ts)
// against the BUILT demo site, served with demo/_headers, into demo-video/. Not part of
// `npm run e2e`: its file name doesn't match the default *.spec.ts pattern.
// IPv4, never `localhost` (#283, see playwright.config.ts): the server and URLs use one address.
const HOST = "127.0.0.1";
const PORT = 4175;

export default defineConfig({
  testDir: "./e2e/video",
  testMatch: /\.video\.ts$/,
  // One long, paced take; a retry would only record the same thing again.
  retries: 0,
  timeout: 180_000,
  reporter: "list",
  use: {
    ...devices["Desktop Chrome"],
    baseURL: `http://${HOST}:${PORT}`,
    timezoneId: "UTC",
    locale: "en-US",
  },
  webServer: {
    command: `npm run build:demo && npx vite preview --mode demo --host ${HOST} --port ${PORT} --strictPort`,
    url: `http://${HOST}:${PORT}`,
    reuseExistingServer: false,
    timeout: 180_000,
  },
});

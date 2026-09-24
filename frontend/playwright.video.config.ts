import { defineConfig, devices } from "@playwright/test";

// `npm run demo:video` (ADR-0026): records the demo walkthrough (e2e/video/walkthrough.video.ts)
// against the BUILT demo site, served with demo/_headers, into demo-video/. Not part of
// `npm run e2e`: its file name doesn't match the default *.spec.ts pattern.
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
    baseURL: `http://localhost:${PORT}`,
    timezoneId: "UTC",
    locale: "en-US",
  },
  webServer: {
    command: `npm run build:demo && npx vite preview --mode demo --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
    timeout: 180_000,
  },
});

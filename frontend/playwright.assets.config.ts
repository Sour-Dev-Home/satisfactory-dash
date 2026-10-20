import { defineConfig, devices } from "@playwright/test";

// The brand assets in public/ (#444), drawn by Chromium from committed sources, so they stay true to
// the app. Not part of `npm run e2e`: the file names don't match the default *.spec.ts pattern.
//   npm run assets:icons -w frontend    favicon.svg, the app icons and site.webmanifest, from the logo
//   npm run assets:preview -w frontend  overview-preview.png, the landing's still, from the built demo
// No web server: the preview serves dist-demo/ to the page itself (page.route), so nothing listens.
export default defineConfig({
  testDir: "./e2e/assets",
  testMatch: /\.assets\.ts$/,
  retries: 0,
  reporter: "list",
  use: {
    ...devices["Desktop Chrome"],
    timezoneId: "UTC",
    locale: "en-US",
  },
});

import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, join, normalize, sep } from "node:path";
import { expect, test } from "@playwright/test";
import { DEMO_EPOCH } from "../../src/demo/world";
import { PREVIEW } from "../../src/landing/preview";

// `npm run assets:preview -w frontend` (#444): the landing's Overview still (public/overview-preview.png),
// taken from the built demo (dist-demo/, made by `npm run build:demo` first) with the demo's clock pinned,
// so it shows the real app on the demo's made-up factory. Rerun it when the Overview changes, and commit it.
// The page is served from dist-demo/ by page.route, not a server: nothing listens on a port.
const ROOT = join(import.meta.dirname, "..", "..");
const DIST = join(ROOT, "dist-demo");
const ORIGIN = "http://preview.invalid";
/** The still's budget: the landing's largest paint, so it must stay light (it's a flat, dark UI). */
const MAX_BYTES = 200 * 1024;
/** A desktop window, wider than the app's column (max-w-6xl) and taller than the still. */
const VIEWPORT = { width: 1280, height: 900 };
/** Canvas kept above the tab row, inside the header's bottom padding (pb-5), so no banner edge shows. */
const TOP_MARGIN = 16;

const TYPES = new Map([
  [".html", "text/html"],
  [".js", "text/javascript"],
  [".css", "text/css"],
  [".woff2", "font/woff2"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".json", "application/json"],
  [".webmanifest", "application/manifest+json"],
]);

test("overview preview", async ({ browser }) => {
  expect(existsSync(join(DIST, "index.html")), "run `npm run build:demo` first").toBe(true);
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const offOrigin: string[] = [];
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== ORIGIN) {
      offOrigin.push(url.href);
      return route.abort();
    }
    // A built file, or index.html for an app route (the Workers config's single-page-application mode).
    const file = normalize(join(DIST, decodeURIComponent(url.pathname)));
    const found = file.startsWith(DIST + sep) && existsSync(file) && statSync(file).isFile();
    const path = found ? file : join(DIST, "index.html");
    return route.fulfill({ body: readFileSync(path), contentType: TYPES.get(extname(path)) ?? "application/octet-stream" });
  });
  await page.clock.setFixedTime(DEMO_EPOCH);

  await page.goto(`${ORIGIN}/?clock=fixed`);
  await page.getByRole("button", { name: "Enter demo" }).click();
  await expect(page.getByRole("list", { name: "Sections" }).getByText(/Demo World · 3 \/ 4 players/)).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  // The app's column from its tab row down: the landing's own header already shows the logo, so the
  // still starts at the tabs, with the column's gutters as its margin.
  const column = (await page.locator("#root > div").boundingBox())!;
  const main = (await page.locator("main").boundingBox())!;
  const clip = { x: column.x, y: main.y - TOP_MARGIN, width: PREVIEW.width, height: PREVIEW.height };
  expect(column.width, "the column's width is src/landing/preview.ts's").toBe(PREVIEW.width);
  const png = await page.screenshot({ path: join(ROOT, "public", PREVIEW.src.slice(1)), clip, animations: "disabled" });

  expect([png.readUInt32BE(16), png.readUInt32BE(20)], "src/landing/preview.ts's width and height").toEqual([PREVIEW.width, PREVIEW.height]);
  expect(png.length, `under ${MAX_BYTES} bytes`).toBeLessThan(MAX_BYTES);
  expect(offOrigin, "the demo must never touch the network").toEqual([]);
  await context.close();
});

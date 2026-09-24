import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { DEMO_EPOCH } from "../../src/demo/world";

// The demo walkthrough (ADR-0026): Enter demo -> Overview -> Power -> Factory -> auto-pause,
// about 70 s at 1920x1080, recorded against the built demo. `?clock=fixed` pins the demo's
// world to DEMO_EPOCH and page.clock pins the page's Date to it, so every take is the same.
// scripts/encode-demo-video.mjs turns the WebM into an H.264 MP4.
const OUT = join(import.meta.dirname, "..", "..", "demo-video");
const VIDEO = { width: 1920, height: 1080 };
// At 1920 CSS px the app is a narrow column, so the page is zoomed 1.5x: the 1280x720 layout,
// filling the frame. (A 1.5 deviceScaleFactor doesn't: recordings are in CSS pixels.)
const ZOOM = 1.5;
const POSTER = { width: 1200, height: 630 };

/** Holds still so a viewer can read the screen. */
const hold = (page: Page, seconds: number) => page.waitForTimeout(seconds * 1000);

/** Zooms the page, and adds a visible pointer: Playwright's recordings don't show the mouse. */
function prepareForVideo(page: Page) {
  return page.addInitScript((zoom) => {
    addEventListener("DOMContentLoaded", () => {
      document.documentElement.style.zoom = String(zoom);
      const dot = document.createElement("div");
      Object.assign(dot.style, {
        position: "fixed", left: "0", top: "0", width: "22px", height: "22px", margin: "-11px 0 0 -11px",
        borderRadius: "50%", background: "rgba(255,255,255,0.35)", border: "2px solid rgba(255,255,255,0.9)",
        pointerEvents: "none", zIndex: "2147483647", transition: "transform 80ms",
      });
      document.body.append(dot);
      // The dot sits inside the zoomed page, so its CSS position is scaled by the zoom.
      addEventListener("mousemove", (e) => {
        dot.style.left = `${e.clientX / zoom}px`;
        dot.style.top = `${e.clientY / zoom}px`;
      });
      addEventListener("mousedown", () => { dot.style.transform = "scale(0.7)"; });
      addEventListener("mouseup", () => { dot.style.transform = ""; });
    });
  }, ZOOM);
}

/** Moves the pointer to the element in visible steps, then clicks it. */
async function clickSlowly(page: Page, target: ReturnType<Page["locator"]>) {
  const box = await target.boundingBox();
  if (!box) throw new Error("click target has no box");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 30 });
  await hold(page, 0.4);
  await target.click();
}

/** Scrolls down and back in small steps, for pages taller than the screen. */
async function scrollThrough(page: Page, pixels: number) {
  for (let i = 0; i < 20; i++) { await page.mouse.wheel(0, pixels / 20); await page.waitForTimeout(60); }
  await hold(page, 3);
  for (let i = 0; i < 20; i++) { await page.mouse.wheel(0, -pixels / 20); await page.waitForTimeout(40); }
}

/** A page that fails the take on a CSP violation, any /api call or any off-origin request. */
async function offlinePage(browser: Browser, baseURL: string, options: Parameters<Browser["newContext"]>[0]) {
  const context = await browser.newContext({ ...options, baseURL });
  const page = await context.newPage();
  const problems: string[] = [];
  const origin = new URL(baseURL).origin;
  page.on("request", (r) => {
    const url = new URL(r.url());
    if (!["data:", "blob:"].includes(url.protocol) && url.origin !== origin) problems.push(`off-origin ${r.url()}`);
  });
  page.on("console", (m) => { if (/Content[- ]Security[- ]Policy/i.test(m.text())) problems.push(m.text()); });
  await page.route("**/api/**", (route) => { problems.push(`/api ${route.request().url()}`); return route.abort(); });
  await page.clock.setFixedTime(DEMO_EPOCH);
  return { context, page, problems };
}

test.beforeAll(() => {
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
});

test("walkthrough", async ({ browser, baseURL }) => {
  const { context, page, problems } = await offlinePage(browser, baseURL!, {
    viewport: VIDEO,
    deviceScaleFactor: 1,
    recordVideo: { dir: join(OUT, "raw"), size: VIDEO },
  });
  await prepareForVideo(page);

  await page.goto("/?clock=fixed");
  const enter = page.getByRole("button", { name: "Enter demo" });
  await expect(enter).toBeVisible();
  await hold(page, 4);
  await clickSlowly(page, enter);

  // Overview: the status-page summary.
  await expect(page.getByRole("list", { name: "Sections" }).getByText(/Demo World · 3 \/ 4 players/)).toBeVisible();
  await hold(page, 8);

  const nav = page.getByRole("navigation", { name: "Main" });
  await clickSlowly(page, nav.getByRole("link", { name: "Power" }));
  await expect(page.getByRole("article", { name: "Circuit 0", exact: true })).toBeVisible();
  await expect(page.locator(".power-chart canvas").first()).toBeVisible();
  await hold(page, 6);
  await scrollThrough(page, 900);
  await hold(page, 4);

  await clickSlowly(page, nav.getByRole("link", { name: "Factory" }));
  await expect(page.getByText("9 machines · 1 backed up · 0 paused · 0 without a recipe")).toBeVisible();
  await hold(page, 6);
  await scrollThrough(page, 900);
  await hold(page, 4);

  await clickSlowly(page, nav.getByRole("link", { name: "Settings" }));
  const toggle = page.getByRole("checkbox", { name: "Auto-pause when no players are connected" });
  await expect(toggle).toBeEnabled();
  await hold(page, 4);
  await clickSlowly(page, toggle);
  await expect(page.getByText("Change pending: the server will apply it.")).toBeVisible();
  await hold(page, 6);

  await clickSlowly(page, nav.getByRole("link", { name: "Overview" }));
  await page.mouse.move(VIDEO.width - 120, VIDEO.height - 120, { steps: 30 });
  await hold(page, 5);

  const video = page.video();
  await context.close();
  await video!.saveAs(join(OUT, "walkthrough.webm"));
  rmSync(join(OUT, "raw"), { recursive: true, force: true });
  expect(problems, "the demo must never touch the network").toEqual([]);
});

// The poster doubles as the landing page's og:image, which wants 1200x630.
test("poster", async ({ browser, baseURL }) => {
  const { context, page, problems } = await offlinePage(browser, baseURL!, { viewport: POSTER, deviceScaleFactor: 1 });
  await page.goto("/?clock=fixed");
  await page.getByRole("button", { name: "Enter demo" }).click();
  await expect(page.getByRole("list", { name: "Sections" }).getByText(/Demo World · 3 \/ 4 players/)).toBeVisible();
  await page.screenshot({ path: join(OUT, "poster.png"), animations: "disabled" });
  await context.close();
  expect(problems, "the demo must never touch the network").toEqual([]);
});

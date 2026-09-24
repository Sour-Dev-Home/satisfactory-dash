import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { DEMO_EPOCH } from "../../src/demo/world";

// The demo walkthrough (ADR-0026): Enter demo -> Overview -> Power -> Factory -> Map ->
// auto-pause, about 75 s at 1920x1080, recorded against the built demo. `?clock=fixed` pins
// the demo's world to DEMO_EPOCH and page.clock pins the page's Date to it, so every take is
// the same. Frames are captured lossless (PNG, see startCapture) and
// scripts/encode-demo-video.mjs encodes them to an H.264 MP4 with colour tags.
const OUT = join(import.meta.dirname, "..", "..", "demo-video");
const FRAMES = join(OUT, "frames");
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

/**
 * Captures the page as lossless PNG frames with Chrome's own screencast (CDP), not Playwright's
 * recordVideo: that one is a low-bitrate VP8 stream whose frames re-compress differently, so
 * flat dark colours shimmered through the whole video (the owner's report). The screencast
 * sends a frame whenever the page changes; each frame is shown until the next one, which the
 * returned stop() writes as an ffmpeg concat list (frames.txt) with per-frame durations.
 */
async function startCapture(page: Page) {
  mkdirSync(FRAMES, { recursive: true });
  const cdp = await page.context().newCDPSession(page);
  const frames: { file: string; at: number }[] = [];
  const acks: Promise<unknown>[] = [];
  cdp.on("Page.screencastFrame", ({ data, metadata, sessionId }) => {
    const file = join(FRAMES, `${String(frames.length).padStart(5, "0")}.png`);
    writeFileSync(file, Buffer.from(data, "base64"));
    frames.push({ file, at: metadata.timestamp ?? Date.now() / 1000 });
    acks.push(cdp.send("Page.screencastFrameAck", { sessionId }).catch(() => undefined));
  });
  await cdp.send("Page.startScreencast", { format: "png", maxWidth: VIDEO.width, maxHeight: VIDEO.height, everyNthFrame: 1 });

  return async () => {
    const end = Date.now() / 1000;
    await cdp.send("Page.stopScreencast");
    await Promise.all(acks);
    if (frames.length === 0) throw new Error("the screencast sent no frames");
    const path = (file: string) => file.replaceAll("\\", "/").replaceAll("'", "'\\''");
    const lines = frames.flatMap(({ file, at }, i) => {
      const next = i + 1 < frames.length ? frames[i + 1].at : end;
      return [`file '${path(file)}'`, `duration ${Math.max(next - at, 0.001).toFixed(4)}`];
    });
    // The concat demuxer ignores the last entry's duration unless the file is listed again.
    lines.push(`file '${path(frames[frames.length - 1].file)}'`);
    writeFileSync(join(OUT, "frames.txt"), `ffconcat version 1.0\n${lines.join("\n")}\n`);
  };
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
  // Both CSP signals, as e2e/fixtures.ts's guards: the console message and the DOM event.
  page.on("console", (m) => { if (/Content[- ]Security[- ]Policy/i.test(m.text())) problems.push(m.text()); });
  await page.exposeFunction("__reportCspViolation", (text: string) => problems.push(text));
  await page.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (e) => {
      (window as unknown as { __reportCspViolation: (t: string) => void })
        .__reportCspViolation(`${e.effectiveDirective} blocked ${e.blockedURI || "inline"}`);
    });
  });
  await page.route("**/api/**", (route) => { problems.push(`/api ${route.request().url()}`); return route.abort(); });
  await page.clock.setFixedTime(DEMO_EPOCH);
  return { context, page, problems };
}

test.beforeAll(() => {
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
});

test("walkthrough", async ({ browser, baseURL }) => {
  const { context, page, problems } = await offlinePage(browser, baseURL!, { viewport: VIDEO, deviceScaleFactor: 1 });
  await prepareForVideo(page);

  await page.goto("/?clock=fixed");
  const enter = page.getByRole("button", { name: "Enter demo" });
  await expect(enter).toBeVisible();
  // Capture starts only now: no blank white page before the app's first paint.
  const stopCapture = await startCapture(page);
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

  // The live map (ADR-0023): the demo world's buildings on the grid, and one zoom step.
  await clickSlowly(page, nav.getByRole("link", { name: "Map" }));
  await expect(page.getByRole("application", { name: /Factory map/ })).toBeVisible();
  await expect(page.getByText(/^9 buildings on the map:/)).toBeVisible();
  await hold(page, 5);
  await clickSlowly(page, page.getByRole("button", { name: "Zoom in" }));
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

  await stopCapture();
  await context.close();
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

import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";

// The command bar's chunk is preloaded once the app is idle (lib/idle.ts), so the first Ctrl+K has no loading
// state, and never under Save-Data. The preload must not block the page: no long task (over LONG_TASK_MS) while it
// downloads and runs.

/** A long task this size is a visible stall (a missed frame or two at least); the chunk is small and should be far under. */
const LONG_TASK_MS = 200;
/** IDLE_START_DELAY_MS plus IDLE_TIMEOUT_MS in lib/idle.ts, plus slack: by then an idle preload has started. */
const PRELOAD_DEADLINE_MS = 10_000;

/** Resolves with the time (page clock) the palette chunk's response arrived; the chunk is the one with cmdk's root. */
function paletteChunk(page: Page, timeout = PRELOAD_DEADLINE_MS) {
  return page.waitForResponse(
    async (response) => /\/assets\/.+\.js$/.test(response.url()) && (await response.text()).includes("cmdk-root"),
    { timeout },
  );
}

test("the search chunk is preloaded while idle, so the first Ctrl+K shows the search at once", async ({ page, mockApi }) => {
  await page.addInitScript(() => {
    const w = window as unknown as { __longTasks: { start: number; duration: number }[] };
    w.__longTasks = [];
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) w.__longTasks.push({ start: entry.startTime, duration: entry.duration });
    }).observe({ type: "longtask", buffered: true });
  });
  await mockApi("default");
  const chunk = paletteChunk(page);
  await page.goto("/app");
  await expect(page.getByRole("button", { name: "Search (Ctrl+K)" })).toBeVisible();
  // No pointer or key input: only the idle preload can fetch it.
  await chunk;
  const preloadedAt = await page.evaluate(() => performance.now());
  // A beat for the chunk to run, then: no long task from the reveal on (the app's own start is not this test's).
  await page.waitForTimeout(500);
  const stalls = await page.evaluate(
    ({ from, max }) =>
      (window as unknown as { __longTasks: { start: number; duration: number }[] }).__longTasks.filter(
        (t) => t.start + t.duration >= from && t.duration > max,
      ),
    { from: preloadedAt - 1_000, max: LONG_TASK_MS },
  );
  expect(stalls, "long tasks around the idle preload").toEqual([]);

  await page.keyboard.press("Control+k");
  const dialog = page.getByRole("dialog", { name: "Search" });
  await expect(dialog.getByRole("combobox")).toBeFocused();
  await expect(dialog.getByText("Loading search…")).toHaveCount(0);
});

test("under Save-Data nothing is preloaded, and the bar still opens", async ({ page, mockApi }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "connection", { value: { saveData: true, effectiveType: "4g" }, configurable: true });
  });
  await mockApi("default");
  let fetched = false;
  page.on("response", async (response) => {
    if (/\/assets\/.+\.js$/.test(response.url()) && (await response.text().catch(() => "")).includes("cmdk-root")) fetched = true;
  });
  await page.goto("/app");
  await expect(page.getByRole("button", { name: "Search (Ctrl+K)" })).toBeVisible();
  await page.waitForTimeout(PRELOAD_DEADLINE_MS / 2);
  expect(fetched, "the search chunk was fetched with no input under Save-Data").toBe(false);

  const chunk = paletteChunk(page);
  await page.keyboard.press("Control+k");
  await chunk;
  await expect(page.getByRole("dialog", { name: "Search" }).getByRole("combobox")).toBeFocused();
});

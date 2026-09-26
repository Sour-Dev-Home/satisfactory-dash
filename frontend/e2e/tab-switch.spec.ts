import type { Page } from "@playwright/test";
import { expect, settleAnimations, test } from "./fixtures";

/**
 * ADR-0032 step 2, the first UX budget: switching between the main tabs shows no staged pop-in.
 * Each endpoint answers after a different delay (100-600 ms), so a view whose parts appear as their
 * own queries land moves the page each time one does. The budget is CLS <= 0.02 across a switch,
 * with motion on and off.
 *
 * Unlike the browser's CLS, shifts right after the click count too (`hadRecentInput` is ignored):
 * the staged pop-in the owner sees happens exactly then. Only the first 100 ms, when one page
 * replaces the other, is left out.
 */
const BUDGET = 0.02;

/** Per-endpoint delays, longest last. Sign-in and the server list gate the shell, not a tab. */
const DELAYS: [RegExp, number][] = [
  [/\/status$/, 100],
  [/\/players$/, 250],
  [/\/history\/items/, 300],
  [/\/power$/, 400],
  [/\/history\/transitions/, 450],
  [/\/factory$/, 500],
  [/\/power\/history/, 550],
  [/\/history\/power/, 600],
];

async function staggerApi(page: Page): Promise<void> {
  // Registered after mockApi, so it runs first and hands each request on once its delay is up.
  await page.route("**/api/**", async (route) => {
    const { pathname } = new URL(route.request().url());
    const delay = DELAYS.find(([pattern]) => pattern.test(pathname))?.[1] ?? 0;
    if (delay) await new Promise((r) => setTimeout(r, delay));
    return route.fallback();
  });
}

/** Starts summing layout shifts; the returned function reads the total since `from` (ms). */
async function watchShifts(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __shifts: { t: number; v: number }[] };
    w.__shifts = [];
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as unknown as { startTime: number; value: number }[]) {
        w.__shifts.push({ t: entry.startTime, v: entry.value });
      }
    }).observe({ type: "layout-shift", buffered: false });
  });
}

async function shiftSince(page: Page, from: number): Promise<number> {
  return page.evaluate(
    (start) =>
      (window as unknown as { __shifts: { t: number; v: number }[] }).__shifts
        .filter((s) => s.t >= start)
        .reduce((sum, s) => sum + s.v, 0),
    from,
  );
}

/** Clicks a main tab, waits for every request to land and the page to settle, returns the CLS. */
async function switchTo(page: Page, tab: string): Promise<number> {
  const clickedAt = await page.evaluate(() => performance.now());
  await page.getByRole("navigation").getByRole("link", { name: tab, exact: true }).click();
  // Longer than the longest delay plus rendering; networkidle alone misses a lazy chunk's render.
  await page.waitForLoadState("networkidle");
  await expect(page.locator("[data-chart-loading]")).toHaveCount(0, { timeout: 15_000 });
  await page.waitForTimeout(300);
  await settleAnimations(page);
  return shiftSince(page, clickedAt + 100);
}

for (const motion of ["no-preference", "reduce"] as const) {
  test.describe(`tab switch, motion ${motion}`, () => {
    test.use({ reducedMotion: motion });

    test(`stays under CLS ${BUDGET} across the main tabs`, async ({ page, mockApi }, testInfo) => {
      await mockApi("default");
      await staggerApi(page);
      await page.goto("/app");
      await expect(page.getByRole("heading", { name: "Health" })).toBeVisible();
      await page.waitForLoadState("networkidle");
      await watchShifts(page);

      const scores: Record<string, number> = {};
      for (const tab of ["Power", "Factory", "Overview", "Power"]) {
        const key = scores[tab] === undefined ? tab : `${tab} (again)`;
        scores[key] = await switchTo(page, tab);
      }
      await testInfo.attach("cls.json", { body: JSON.stringify(scores, null, 2), contentType: "application/json" });
      for (const [tab, cls] of Object.entries(scores)) {
        expect.soft(cls, `CLS switching to ${tab}`).toBeLessThanOrEqual(BUDGET);
      }
    });
  });
}

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

interface Shift {
  t: number;
  v: number;
  /** What moved, for the report: each source's element and how far its top went. */
  moved: string[];
}

/** Starts recording layout shifts, with what moved in each. */
async function watchShifts(page: Page): Promise<void> {
  await page.evaluate(() => {
    type Source = { node?: Node; previousRect: DOMRectReadOnly; currentRect: DOMRectReadOnly };
    const w = window as unknown as { __shifts: Shift[] };
    const describe = (node?: Node) => {
      if (!(node instanceof Element)) return node?.nodeName ?? "?";
      const text = (node.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 40);
      return `${node.tagName.toLowerCase()} "${text}"`;
    };
    w.__shifts = [];
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as unknown as { startTime: number; value: number; sources: Source[] }[]) {
        w.__shifts.push({
          t: entry.startTime,
          v: entry.value,
          moved: entry.sources.map((s) => `${describe(s.node)} ${Math.round(s.previousRect.y)}→${Math.round(s.currentRect.y)}`),
        });
      }
    }).observe({ type: "layout-shift", buffered: false });
  });
}

async function shiftsSince(page: Page, from: number): Promise<Shift[]> {
  return page.evaluate(
    (start) => (window as unknown as { __shifts: Shift[] }).__shifts.filter((s) => s.t >= start),
    from,
  );
}

/** Clicks a main tab, waits for every request to land and the page to settle, returns its shifts. */
async function switchTo(page: Page, tab: string): Promise<Shift[]> {
  const clickedAt = await page.evaluate(() => performance.now());
  await page.getByRole("navigation").getByRole("link", { name: tab, exact: true }).click();
  // Longer than the longest delay plus rendering; networkidle alone misses a lazy chunk's render.
  await page.waitForLoadState("networkidle");
  await expect(page.locator("[data-chart-loading]")).toHaveCount(0, { timeout: 15_000 });
  await page.waitForTimeout(300);
  await settleAnimations(page);
  return shiftsSince(page, clickedAt + 100);
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

      const shifts: Record<string, Shift[]> = {};
      for (const tab of ["Power", "Factory", "Overview", "Power"]) {
        shifts[shifts[tab] ? `${tab} (again)` : tab] = await switchTo(page, tab);
      }
      const scores = Object.fromEntries(
        Object.entries(shifts).map(([tab, list]) => [tab, list.reduce((sum, s) => sum + s.v, 0)]),
      );
      // Printed as well as attached: CI keeps the log of a passing test, not its attachments.
      const report = JSON.stringify({ project: testInfo.project.name, motion, scores, shifts }, null, 1);
      console.log(`tab-switch CLS ${report}`);
      await testInfo.attach("cls.json", { body: report, contentType: "application/json" });
      for (const [tab, cls] of Object.entries(scores)) {
        expect.soft(cls, `CLS switching to ${tab}`).toBeLessThanOrEqual(BUDGET);
      }
    });
  });
}

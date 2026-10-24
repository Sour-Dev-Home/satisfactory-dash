import type { Page } from "@playwright/test";
import { expect, settleAnimations, test } from "./fixtures";

/**
 * #494: one stable reveal per page, skeletons, prefetched tabs.
 *
 * - A page holds its panels back (nothing painted) until its primary reads answer or the 400 ms budget
 *   passes, then shows them together. Checked every frame, so a single early paint fails.
 * - A fast load never flashes a skeleton.
 * - Whatever is already on screen at the reveal does not move when a slower panel fills in: panel boxes
 *   before and after, plus the layout-shift total (the same 0.02 budget as e2e/tab-switch.spec.ts).
 * - Hovering a tab starts its reads.
 * - Reduced motion: no shimmer, no movement.
 */
const CLS_BUDGET = 0.02;
/** How far a panel that was already on screen at the reveal may end up from there (a control row). */
const PANEL_DRIFT_PX = 48;

const PAGES = [
  { name: "Overview", path: "/app", ready: "Total play time on this save" },
  { name: "Power", path: "/app/power", ready: /Circuit 0/ },
  { name: "Factory", path: "/app/factory", ready: /machines · .* backed up/ },
  { name: "Planner", path: "/app/planner", ready: "Production planner" },
  { name: "Map", path: "/app/map", ready: "Buildings in view" },
  { name: "Settings", path: "/app/settings", ready: /Auto-pause when no players/ },
] as const;

interface Probe {
  /** A real panel or skeleton block was visible before the page said it was revealed. */
  paintedEarly: boolean;
  /** A skeleton was ever shown (data-loading="shown"). */
  skeletonShown: boolean;
  /** Sum of layout-shift values from the page's own mount on (the app's sign-in and shell come before it). */
  cls: number;
  /** What moved, for the failure message. */
  shifts: string[];
  /** The real panels' boxes in the first frame the page showed. */
  atReveal: Boxes | null;
}

type Boxes = Record<string, { x: number; y: number; width: number }>;

/** Records, every frame and for every layout shift, from before the app starts. */
async function installProbe(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const probe: Probe = { paintedEarly: false, skeletonShown: false, cls: 0, shifts: [], atReveal: null };
    let pageMountedAt = Infinity;
    const boxes = (): Boxes => {
      const found: Boxes = {};
      for (const el of document.querySelectorAll("[data-page-reveal] section[aria-labelledby]")) {
        const heading = document.getElementById(el.getAttribute("aria-labelledby") ?? "");
        const rect = el.getBoundingClientRect();
        found[heading?.textContent?.trim() || el.getAttribute("aria-labelledby") || "?"] = {
          x: Math.round(rect.x),
          y: Math.round(rect.y + window.scrollY),
          width: Math.round(rect.width),
        };
      }
      return found;
    };
    (window as unknown as { __probe: Probe; __boxes: () => Boxes }).__probe = probe;
    (window as unknown as { __boxes: () => Boxes }).__boxes = boxes;
    const frame = () => {
      const container = document.querySelector("[data-page-reveal]");
      if (container) {
        if (pageMountedAt === Infinity) pageMountedAt = performance.now();
        if (container.getAttribute("data-page-reveal") !== "revealed") {
          const painted = [...container.querySelectorAll("section, [data-skeleton], h3")].some(
            (el) => getComputedStyle(el).visibility !== "hidden",
          );
          if (painted) probe.paintedEarly = true;
        } else if (!probe.atReveal) {
          probe.atReveal = boxes();
        }
      }
      if (document.querySelector('[data-loading="shown"]')) probe.skeletonShown = true;
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries() as unknown as { value: number; startTime: number; sources?: { node?: Node }[] }[]) {
          // The app's own mount (sign-in, then the shell, which moves the footer) lands in the same frames
          // as the page's; only what happens after them is the page's.
          if (entry.startTime < pageMountedAt + 150) continue; // shifts this soon after the page mounts are the app shell appearing
          probe.cls += entry.value;
          probe.shifts.push(
            `${entry.value.toFixed(4)} @${Math.round(entry.startTime)}ms ${(entry.sources ?? []).map((s) => s.node?.nodeName).join(",")}`,
          );
        }
      }).observe({ type: "layout-shift", buffered: true });
    } catch {
      // No layout-shift entries in this browser: the box comparison still runs.
    }
  });
}

const readProbe = (page: Page) => page.evaluate(() => (window as unknown as { __probe: Probe }).__probe);

/** The boxes of the real panels on screen (named sections), by name. */
const panelBoxes = (page: Page) => page.evaluate(() => (window as unknown as { __boxes: () => Boxes }).__boxes());

for (const motion of ["no-preference", "reduce"] as const) {
  test.describe(`page reveal, motion ${motion}`, () => {
    test.use({ reducedMotion: motion });

    for (const { name, path, ready } of PAGES) {
      test(`${name}: nothing is painted before the reveal, and nothing on screen moves after it`, async ({ page, mockApi }) => {
        await installProbe(page);
        await mockApi("slow-queries");
        await page.goto(path);
        // The reads take 800 ms, past the 400 ms budget: the page reveals with skeletons, then fills in.
        await expect(page.locator('[data-page-reveal="revealed"]')).toBeVisible({ timeout: 10_000 });

        await expect(page.getByText(ready).first()).toBeVisible({ timeout: 15_000 });
        await expect(page.locator("[data-chart-loading]")).toHaveCount(0, { timeout: 15_000 });
        await expect(page.locator('[data-loading="shown"]')).toHaveCount(0, { timeout: 15_000 });
        await page.waitForTimeout(500);
        await settleAnimations(page);
        const settled = await panelBoxes(page);

        const probe = await readProbe(page);
        expect(probe.paintedEarly, "a panel or skeleton was painted before the page revealed").toBe(false);
        expect(probe.atReveal, "the page never reported its reveal").not.toBeNull();
        for (const [panel, box] of Object.entries(probe.atReveal ?? {})) {
          const after = settled[panel];
          expect(after, `${panel} should still be on the page`).toBeDefined();
          // Skeletons are estimates of their panels (a table's row count, a rule list's length vary),
          // so a panel below a slower one may drift by about a control row, never more; the exact
          // cost is the layout-shift total below. Across (x, width) nothing moves at all.
          expect({ x: after.x, width: after.width }, `${panel} moved sideways`).toEqual({ x: box.x, width: box.width });
          expect(Math.abs(after.y - box.y), `${panel} jumped when a slower panel filled in`).toBeLessThanOrEqual(PANEL_DRIFT_PX);
        }
        expect(probe.cls, `layout shifts: ${probe.shifts.join(" | ")}`).toBeLessThanOrEqual(CLS_BUDGET);
      });

      test(`${name}: a fast load never shows a skeleton`, async ({ page, mockApi }) => {
        await installProbe(page);
        await mockApi("default");
        await page.goto(path);
        await expect(page.getByText(ready).first()).toBeVisible({ timeout: 15_000 });
        await expect(page.locator("[data-chart-loading]")).toHaveCount(0, { timeout: 15_000 });
        await page.waitForTimeout(600);
        const probe = await readProbe(page);
        expect(probe.skeletonShown, "a skeleton flashed on a fast load").toBe(false);
        expect(probe.paintedEarly).toBe(false);
      });
    }
  });
}

test.describe("skeletons under reduced motion", () => {
  test.use({ reducedMotion: "reduce" });

  test("have no shimmer and the page has no movement", async ({ page, mockApi }) => {
    await mockApi("loading-panels");
    await page.goto("/app/factory");
    const skeleton = page.locator('[data-loading="shown"] [data-skeleton]').first();
    await expect(skeleton).toBeVisible({ timeout: 10_000 });
    expect(await skeleton.evaluate((el) => getComputedStyle(el).animationName)).toBe("none");
    // The reveal animation ends at once: its duration is 0.
    const revealed = page.locator('[data-page-reveal="revealed"]');
    expect(await revealed.evaluate((el) => getComputedStyle(el).animationDuration)).toBe("0s");
  });
});

test.describe("skeletons with motion", () => {
  test.use({ reducedMotion: "no-preference" });

  test("shimmer slowly, as opacity only", async ({ page, mockApi }) => {
    await mockApi("loading-panels");
    await page.goto("/app/factory");
    const skeleton = page.locator('[data-loading="shown"] [data-skeleton]').first();
    await expect(skeleton).toBeVisible({ timeout: 10_000 });
    expect(await skeleton.evaluate((el) => getComputedStyle(el).animationName)).toBe("shimmer");
  });
});

test.describe("prefetch", () => {
  test("hovering a tab starts its reads, so the click finds them cached", async ({ page, mockApi }) => {
    await mockApi("default");
    await page.goto("/app");
    await expect(page.getByText("Total play time on this save")).toBeVisible();
    const nav = page.getByRole("navigation", { name: "Main" });

    // The Overview already read the factory and power; settings is a page the Overview never touches.
    const settingsRequest = page.waitForRequest((r) => /\/settings$/.test(new URL(r.url()).pathname));
    await nav.getByRole("link", { name: "Settings", exact: true }).hover();
    await settingsRequest;
  });

  test("focusing a tab link with the keyboard starts its reads too", async ({ page, mockApi }) => {
    await mockApi("default");
    await page.goto("/app");
    await expect(page.getByText("Total play time on this save")).toBeVisible();
    const nav = page.getByRole("navigation", { name: "Main" });

    const rulesRequest = page.waitForRequest((r) => /\/alerts\/rules$/.test(new URL(r.url()).pathname));
    await nav.getByRole("link", { name: "Settings", exact: true }).focus();
    await rulesRequest;
  });
});

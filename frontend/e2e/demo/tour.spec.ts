import type { Locator, Page } from "@playwright/test";
import { stepLine, tabLabel, TOUR_STEPS } from "../../src/demo/tour/steps";
import { tabTarget } from "../../src/demo/tour/tabTarget";
import { expect, expectNoAxeViolations, test } from "../fixtures";

// The guided tour of the demo (ADR-0065, build PR 2): started by itself on the first visit to /app (no "demo.tour" set
// here, unlike demo.spec.ts), then walked through all its steps with Next. Each step's heading is checked, and its ring
// is checked to sit round its `[data-tour]` target, or the step to show centred with no ring where it has none. The guards
// fixture fails the test on any CSP violation.

/** Steps with no target: the welcome, about the whole page. */
const CENTRED = new Set(TOUR_STEPS.filter((s) => s.target === undefined).map((s) => s.id));
/** Axe-checked with the tour on screen: one per kind of page. */
const AXE_STEPS = new Set(["health", "factory-machines", "planner-group-panel", "settings-alerts", "finish"]);
/** Screenshotted (in CI's Linux image only, PLAYWRIGHT_SNAPSHOTS=1). */
const SHOT_STEPS = new Set(["health", "power-chart", "planner-group-panel", "finish"]);

/** The wait for a target (TOUR_TARGET_WAIT_MS) plus room for the page to load. */
const STEP_TIMEOUT = 15_000;

test.use({ reducedMotion: "reduce" });

async function expectRingRound(page: Page, target: Locator): Promise<void> {
  // The hole follows its target every frame (the page's reveal, a scroll): poll until it has settled round it.
  await expect
    .poll(
      async () => {
        const ring = await page.locator("[data-tour-ring]").boundingBox();
        const box = await target.boundingBox();
        if (ring === null || box === null) return false;
        const slack = 1;
        return (
          ring.x <= box.x + slack &&
          ring.y <= box.y + slack &&
          ring.x + ring.width >= box.x + box.width - slack &&
          ring.y + ring.height >= box.y + box.height - slack
        );
      },
      { timeout: STEP_TIMEOUT },
    )
    .toBe(true);
}

type Rect = { x: number; y: number; width: number; height: number };
const close = (a: Rect, b: Rect, slack = 1.5) =>
  Math.abs(a.x - b.x) <= slack && Math.abs(a.y - b.y) <= slack && Math.abs(a.width - b.width) <= slack && Math.abs(a.height - b.height) <= slack;

/**
 * No pop-in (ADR-0065 amendment, 2026-11-07): as soon as a step shows, its ring is its target's box padded by
 * `--spacing-tour-pad`, and it stays there over the next ~300 ms (the step waited for the page to settle, not just appear).
 */
async function expectNoPopIn(page: Page, target: Locator): Promise<void> {
  const pad = await page.evaluate(() =>
    Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--spacing-tour-pad")),
  );
  const ring = page.locator("[data-tour-ring]");
  const first = await ring.boundingBox();
  const box = await target.boundingBox();
  expect(first, "ring").not.toBeNull();
  expect(box, "target").not.toBeNull();
  // The ring's measured box includes its stroke, half of which lies outside the padded rect.
  const stroke = await ring.evaluate((el) => Number.parseFloat(getComputedStyle(el).strokeWidth) || 0);
  const out = pad + stroke / 2;
  const padded = { x: box!.x - out, y: box!.y - out, width: box!.width + 2 * out, height: box!.height + 2 * out };
  expect(close(first!, padded), `ring ${JSON.stringify(first)} round ${JSON.stringify(padded)}`).toBe(true);
  await page.waitForTimeout(300);
  const later = await ring.boundingBox();
  expect(later !== null && close(later, first!), `ring moved: ${JSON.stringify(first)} then ${JSON.stringify(later)}`).toBe(true);
}

/** The step's tab sits in the scrim's second hole: the tab ring is round it. */
async function expectTabHole(page: Page, path: string): Promise<void> {
  const tab = page.locator(`[data-tour="${tabTarget(path)}"]`);
  const box = await tab.boundingBox();
  const ring = await page.locator("[data-tour-tab-ring]").boundingBox();
  expect(box, "tab").not.toBeNull();
  expect(ring, "tab ring").not.toBeNull();
  const slack = 1;
  expect(
    ring!.x <= box!.x + slack &&
      ring!.y <= box!.y + slack &&
      ring!.x + ring!.width >= box!.x + box!.width - slack &&
      ring!.y + ring!.height >= box!.y + box!.height - slack,
  ).toBe(true);
  // The clip's evenodd path holds the viewport and both holes (three closed shapes), or the viewport and the tab's.
  const d = (await page.locator("#tour-hole path").getAttribute("d")) ?? "";
  expect(d.match(/Z/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
}

test("walks every step of the tour with Next, each ringing its target", async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  await page.goto("/?clock=fixed");
  await page.getByRole("button", { name: "Enter demo" }).click();

  const root = page.locator("[data-tour-root]");
  const dialog = page.getByRole("dialog");
  for (const [i, step] of TOUR_STEPS.entries()) {
    await expect(dialog, `step ${i + 1}`).toHaveAccessibleName(step.title, { timeout: STEP_TIMEOUT });
    // The step line names the tab its page is on.
    await expect(dialog.getByText(stepLine(i + 1, TOUR_STEPS.length, tabLabel(step.path)))).toBeVisible();
    // On a phone too: step 8 presses the planner's Graph button first (its Outline is the phone's default).
    const centred = CENTRED.has(step.id);
    if (centred) {
      await expect(root).toHaveAttribute("data-tour-phase", "fallback");
      await expect(page.locator("[data-tour-ring]")).toHaveCount(0);
    } else {
      await expect(root, step.id).toHaveAttribute("data-tour-phase", "showing");
      const target = page.locator(`[data-tour="${step.target}"]`).first();
      await expectNoPopIn(page, target);
      await expectRingRound(page, target);
      // A try-it step's target must be on screen to be tapped: a phone's planner canvas had the card panned off it.
      if (step.kind === "try") await expect(page.locator(`[data-tour="${step.target}"]`).first()).toBeInViewport();
    }
    // Every step, the welcome and the finish included, shows which tab it is on: its tab in a second hole.
    await expectTabHole(page, step.path);
    // The chart sits below the fold at 1440 x 900: the page is scrolled only as far as keeps the nav, and so the tab's hole,
    // on screen (centring the chart had scrolled it away).
    if (step.id === "power-chart" && (page.viewportSize()?.width ?? 0) >= 1440) {
      await expect(page.locator("[data-tour-tab-ring]")).toBeInViewport();
      await expect(page.locator(`[data-tour="${tabTarget(step.path)}"]`)).toBeInViewport({ ratio: 1 });
    }
    // Placed by attributes only (the CSP's style-src 'self', the repo's no-`style=` rule).
    await expect(page.locator("[data-tour-root][style], [data-tour-root] [style]")).toHaveCount(0);
    if (AXE_STEPS.has(step.id)) await expectNoAxeViolations(page, testInfo);
    if (SHOT_STEPS.has(step.id)) await expect(page).toHaveScreenshot(`tour-${step.id}.png`);
    await dialog.getByRole("button", { name: i === TOUR_STEPS.length - 1 ? "Finish" : "Next" }).click();
  }

  // Finish ends it, and the start had already marked it seen.
  await expect(dialog).toHaveCount(0);
  await expect(root).toHaveCount(0);
  expect(await page.evaluate(() => window.localStorage.getItem("demo.tour"))).toBe("seen");
});

/** Enters the demo and presses Next up to the step with this id (on a phone, step 8 presses the planner's Graph first). */
async function walkTo(page: Page, id: string): Promise<{ dialog: Locator; at: number }> {
  await page.goto("/?clock=fixed");
  await page.getByRole("button", { name: "Enter demo" }).click();
  const dialog = page.getByRole("dialog");
  const at = TOUR_STEPS.findIndex((s) => s.id === id);
  for (const step of TOUR_STEPS.slice(0, at)) {
    await expect(dialog).toHaveAccessibleName(step.title, { timeout: STEP_TIMEOUT });
    await dialog.getByRole("button", { name: "Next" }).click();
  }
  await expect(dialog).toHaveAccessibleName(TOUR_STEPS.at(at)!.title, { timeout: STEP_TIMEOUT });
  await expect(page.locator("[data-tour-root]")).toHaveAttribute("data-tour-phase", "showing", { timeout: STEP_TIMEOUT });
  return { dialog, at };
}

// Try-it steps (build PR 3): doing what the words ask, through the hole, moves the tour on by itself; so does "Do it for
// me", a bubbling click on the target through the page's own handlers.
for (const how of ["a real click", "Do it for me"] as const) {
  test(`the planner's card step moves on to the open panel after ${how}`, async ({ page }) => {
    test.setTimeout(90_000);
    const { dialog, at } = await walkTo(page, "planner-group-card");
    if (how === "a real click") await page.locator('[data-tour="planner-group-card"]').click();
    else await dialog.getByRole("button", { name: "Do it for me" }).click();
    await expect(dialog).toHaveAccessibleName(TOUR_STEPS.at(at + 1)!.title, { timeout: STEP_TIMEOUT });
    const panel = page.locator('[data-tour="planner-group-panel"]');
    await expect(panel).toBeVisible();
    await expect(page.locator("[data-tour-root]")).toHaveAttribute("data-tour-phase", "showing");
    await expectRingRound(page, panel);
    await expect(page.getByRole("status").filter({ hasText: /Step \d+ of/ })).toHaveText(`Done. ${stepLine(at + 2, TOUR_STEPS.length, tabLabel(TOUR_STEPS.at(at + 1)!.path))}`);
  });

  test(`the map's layer step moves on after ${how}`, async ({ page }) => {
    test.setTimeout(120_000);
    const { dialog, at } = await walkTo(page, "map-filters");
    const box = page.getByRole("checkbox", { name: "Belts and pipes" });
    await expect(box).not.toBeChecked();
    if (how === "a real click") await box.click();
    else await dialog.getByRole("button", { name: "Do it for me" }).click();
    const next = TOUR_STEPS.at(at + 1)!;
    await expect(dialog).toHaveAccessibleName(next.title, { timeout: STEP_TIMEOUT });
    await expect(page).toHaveURL(new RegExp(`${next.path}$`));
  });
}

test("the planner's details step opens the group panel itself when Next skipped the click", async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto("/?clock=fixed");
  await page.getByRole("button", { name: "Enter demo" }).click();
  const dialog = page.getByRole("dialog");
  const at = TOUR_STEPS.findIndex((s) => s.id === "planner-group-panel");
  const details = TOUR_STEPS.at(at)!.title;
  const map = TOUR_STEPS.at(at + 1)!.title;
  for (const step of TOUR_STEPS.slice(0, at)) {
    await expect(dialog).toHaveAccessibleName(step.title, { timeout: STEP_TIMEOUT });
    await dialog.getByRole("button", { name: "Next" }).click();
  }
  await expect(dialog).toHaveAccessibleName(details, { timeout: STEP_TIMEOUT });
  const panel = page.locator('[data-tour="planner-group-panel"]');
  await expect(panel).toBeVisible();
  await expect(panel.getByRole("button", { name: /^Show what .+ feeds and needs$/ })).toBeVisible();
  // Back on the map step and back again: the panel was closed by leaving the page, and is opened again (on a phone, after
  // the Graph view is pressed again: the planner remounts on its Outline).
  await dialog.getByRole("button", { name: "Next" }).click();
  await expect(dialog).toHaveAccessibleName(map, { timeout: STEP_TIMEOUT });
  await dialog.getByRole("button", { name: "Back" }).click();
  await expect(dialog).toHaveAccessibleName(details, { timeout: STEP_TIMEOUT });
  await expect(panel).toBeVisible();
  await expect(page.locator("[data-tour-root]")).toHaveAttribute("data-tour-phase", "showing");
});

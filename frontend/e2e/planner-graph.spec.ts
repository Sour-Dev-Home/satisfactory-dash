import type { Locator, Page } from "@playwright/test";
import { expect, expectNoAxeViolations, test } from "./fixtures";

// ADR-0050 task 6, the graph's CSP gate: pan, zoom, the item filter and the group panel, all with zero CSP violations
// (the guards fixture fails the test on any) under the production CSP. dagre must run without eval; the SVG is styled
// by classes and attributes only.

const drawing = (svg: Locator) => svg.locator(":scope > g");
const transformOf = async (svg: Locator) => (await drawing(svg).getAttribute("transform")) ?? "";
const scaleOf = async (svg: Locator) => Number(/scale\(([\d.e-]+)\)/.exec(await transformOf(svg))?.[1]);

test("a site's graph pans, zooms, filters by item and opens a group's machines", async ({ page, mockApi }, testInfo) => {
  await mockApi("planner-group-panel");
  await page.goto("/app/planner");
  await page.getByRole("button", { name: "Open site: Iron Plate site" }).click();
  // 390 px opens on the tables and 1440 px on the graph (Decision 4): one press either way.
  await page.getByRole("button", { name: "Graph" }).click();
  const svg = page.getByRole("img", { name: /^Graph of Iron Plate site: 5 groups, 5 connections/ });
  await expect(svg).toBeVisible();
  // dagre has laid out the cards, and the edge words are drawn.
  // An edge label is two <tspan> lines, item then rate (the <title> tooltip keeps the one-line form).
  await expect(svg.locator("tspan", { hasText: /^Iron Ore$/ }).first()).toBeVisible();
  await expect(svg.locator("tspan", { hasText: /^120 items\/min$/ }).first()).toBeVisible();

  // Wheel zoom about the pointer, then drag to pan.
  const box = (await svg.boundingBox())!;
  const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const fitted = await scaleOf(svg);
  await page.mouse.move(centre.x, centre.y);
  await page.mouse.wheel(0, -300);
  await expect.poll(() => scaleOf(svg)).toBeGreaterThan(fitted);
  const zoomed = await transformOf(svg);
  await page.mouse.down();
  await page.mouse.move(centre.x + 80, centre.y + 40, { steps: 8 });
  await page.mouse.up();
  await expect.poll(() => transformOf(svg)).not.toBe(zoomed);

  // Buttons and keys: zoom out, fit.
  await page.getByRole("button", { name: "Zoom out" }).click();
  await page.getByRole("group", { name: /^Graph viewport/ }).focus();
  await page.keyboard.press("Minus");
  await page.keyboard.press("ArrowLeft");
  await page.getByRole("button", { name: "Fit to view" }).click();
  await expect.poll(() => scaleOf(svg)).toBeCloseTo(fitted, 5);

  // The item filter lights the item's line and says how many groups it reached.
  await page.getByLabel("Item").selectOption({ label: "Iron Ore" });
  await expect(page.getByRole("status")).toContainText("groups carry or feed this item");
  await page.getByLabel("Item").selectOption({ label: "All items" });
  await expect(page.getByRole("status")).toHaveCount(0);

  // The group panel: Enter on a group's button opens it, Escape closes it and returns focus to the group.
  const group = page.getByRole("button", { name: /^8× Constructor, Iron Plate/ });
  await group.focus();
  await page.keyboard.press("Enter");
  const panel = page.getByRole("complementary", { name: /^8× Constructor, Iron Plate/ });
  await expect(panel).toBeVisible();
  await expect(panel.getByRole("listitem")).toHaveCount(8);
  await expect(panel.getByText("Underfed · Clock 150%")).toBeVisible();
  await expectNoAxeViolations(page, testInfo);
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
  await expect(group).toBeFocused();

  // The same panel by pointer: click the card in the picture, after Fit to view (the pans above moved it out of
  // sight, and the fit no longer shrinks the drawing below a readable zoom; it starts at the left, the extractors).
  // The card's drawn name, not its <title> tooltip (same words).
  await page.getByRole("button", { name: "Fit to view" }).click();
  await svg.locator("text", { hasText: /^Miner Mk\.2$/ }).click();
  await expect(page.getByRole("complementary", { name: "Miner Mk.2" })).toBeVisible();
  await page.getByRole("button", { name: "Close" }).click();
  await expect(page.getByRole("complementary")).toHaveCount(0);

  // The tables are one press away and hold the same site.
  await page.getByRole("button", { name: "Tables" }).click();
  await expect(page.getByRole("heading", { name: "Connections" })).toBeVisible();
  await expect(svg).toHaveCount(0);
});

test("a two-finger pinch zooms the graph and a two-finger drag pans it", async ({ page, mockApi }) => {
  await mockApi("planner-group-panel");
  await page.goto("/app/planner");
  await page.getByRole("button", { name: "Open site: Iron Plate site" }).click();
  await page.getByRole("button", { name: "Graph" }).click();
  const svg = page.getByRole("img", { name: /^Graph of Iron Plate site/ });
  await expect(svg).toBeVisible();
  const box = (await svg.boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const fitted = await scaleOf(svg);
  // Playwright's touchscreen only taps, so the two fingers are dispatched as pointer events (they bubble to the window).
  const touch = (type: string, pointerId: number, x: number, y: number) =>
    svg.dispatchEvent(type, { pointerId, pointerType: "touch", isPrimary: pointerId === 1, button: 0, clientX: x, clientY: y });
  await touch("pointerdown", 1, cx - 50, cy);
  await touch("pointerdown", 2, cx + 50, cy);
  await touch("pointermove", 2, cx + 150, cy);
  // The fingers' distance doubled: so did the scale.
  await expect.poll(() => scaleOf(svg)).toBeCloseTo(fitted * 2, 3);
  const pinched = await transformOf(svg);
  // Both fingers move the same way: a pan at the same scale.
  await touch("pointermove", 1, cx - 10, cy + 30);
  await touch("pointermove", 2, cx + 190, cy + 30);
  await expect.poll(() => transformOf(svg)).not.toBe(pinched);
  await expect.poll(() => scaleOf(svg)).toBeCloseTo(fitted * 2, 1);
  await touch("pointerup", 1, cx - 10, cy + 30);
  await touch("pointerup", 2, cx + 190, cy + 30);
});

test("the Planner is a tab, after Factory",async ({ page, mockApi }) => {
  await mockApi("default");
  await page.goto("/app");
  const nav = page.getByRole("navigation", { name: "Main" });
  await expect(nav.getByRole("link", { name: "Planner" })).toBeVisible();
  const labels = await nav.getByRole("link").allTextContents();
  expect(labels.indexOf("Planner")).toBe(labels.indexOf("Factory") + 1);
});

test("an item filter dims the groups it does not reach", async ({ page, mockApi }) => {
  await mockApi("planner-filter-dimmed");
  await page.goto("/app/planner");
  await page.getByRole("button", { name: "Open site: Iron Plate site" }).click();
  await page.getByRole("button", { name: "Graph" }).click();
  const svg = page.getByRole("img", { name: /^Graph of Iron Plate site/ });
  await expect(svg.locator("g.opacity-graph-dim")).toHaveCount(0);
  await page.getByLabel("Item").selectOption({ label: "Iron Ingot" });
  await expect(page.getByRole("status")).toContainText("4 of 5 groups carry or feed this item");
  // The recycler (its card) and nothing else of the cards is faded; the edges that miss the item are too.
  await expect(svg.locator("g.opacity-graph-dim", { hasText: "Iron Plate Recycle" }).first()).toBeAttached();
  expect(await svg.locator("g.opacity-graph-dim").count()).toBeGreaterThan(0);
});

// ADR-0055 PR 8a: the factory canvas under the production CSP (the guards fixture fails the test on any violation).
test.describe("the factory canvas", () => {
  const openPlate = async (page: Page) => {
    await page.getByRole("button", { name: "Open factory: Iron Plate factory" }).focus();
    await page.keyboard.press("Enter");
    await page.getByRole("button", { name: "Graph" }).click();
    const svg = page.getByRole("img", { name: /^Graph of Iron Plate factory/ });
    await expect(svg).toBeVisible();
    return svg;
  };

  test("the overview draws a card per factory with the flow between them, and a card opens its factory", async ({ page, mockApi }) => {
    await mockApi("planner-factories");
    await page.goto("/app/planner");
    await page.getByRole("button", { name: "Graph" }).click();
    const overview = page.getByRole("img", { name: /^Graph of Factories: 2 factories, 1 connection/ });
    await expect(overview).toBeVisible();
    await expect(overview.getByText("Iron Rod factory (+ Iron Rod)", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Open factory: Iron Rod factory" }).focus();
    await page.keyboard.press("Enter");
    await page.getByRole("button", { name: "Graph" }).click();
    await expect(page.getByRole("img", { name: /^Graph of Iron Rod factory: 2 groups, 1 connection/ })).toBeVisible();
    await page.getByRole("button", { name: "All factories" }).click();
    await expect(overview).toBeVisible();
  });

  // ADR-0055 PR 8b: the transport glyphs move by SVG animateMotion, with no inline style and no script, and stop on the Motion toggle.
  test("shows every transport mode as a glyph, moves them, and the Motion toggle stops them and is remembered", async ({ page, mockApi }, testInfo) => {
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await mockApi("planner-factories-transports");
    await page.goto("/app/planner");
    const svg = await openPlate(page);
    for (const mode of ["train", "truck", "drone", "depot"]) await expect(svg.locator(`[data-glyph="${mode}"]`)).toHaveCount(1);
    // Only the edges in view move (one of the four can lie past the fitted canvas), so at least most of them do.
    await expect.poll(() => svg.locator("animateMotion").count()).toBeGreaterThanOrEqual(3);
    await expect(svg.locator("[style]")).toHaveCount(0);
    await expectNoAxeViolations(page, testInfo);

    await page.getByLabel("Motion").selectOption("off");
    await expect(svg.locator("animateMotion")).toHaveCount(0);
    expect(await page.evaluate(() => window.localStorage.getItem("planner.motion"))).toBe("off");
    await page.reload();
    const again = await openPlate(page);
    await expect(page.getByLabel("Motion")).toHaveValue("off");
    await expect(again.locator("animateMotion")).toHaveCount(0);
  });

  test("System follows the operator's reduced-motion setting", async ({ page, mockApi }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await mockApi("planner-factories-transports");
    await page.goto("/app/planner");
    const svg = await openPlate(page);
    await expect(page.getByLabel("Motion")).toHaveValue("system");
    await expect(svg.locator("animateMotion")).toHaveCount(0);
    await expect(svg.locator('[data-glyph="train"]')).toHaveCount(1);
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await expect.poll(() => svg.locator("animateMotion").count()).toBeGreaterThanOrEqual(3);
  });

  test("hides what only feeds a card behind a count, Escape restores it, and storage folds into chips", async ({ page, mockApi }, testInfo) => {
    await mockApi("planner-factories");
    await page.goto("/app/planner");
    const svg = await openPlate(page);
    await page.getByRole("button", { name: "Hide 1 group that only feeds Storage Container" }).focus();
    await page.keyboard.press("Enter");
    await expect(svg.locator('[data-upstream="collapsed"]')).toContainText("+1");
    await page.getByRole("group", { name: /^Graph viewport/ }).focus();
    await page.keyboard.press("Escape");
    await expect(svg.locator('[data-upstream="collapsed"]')).toHaveCount(0);

    await page.getByRole("button", { name: "Storage detail" }).click();
    await expect(svg.getByText("1 flow to storage")).toBeVisible();
    expect(await page.evaluate(() => window.localStorage.getItem("planner.storageDetail"))).toBe("off");
    await expectNoAxeViolations(page, testInfo);
  });

  test("opens a tree in place and folds it again", async ({ page, mockApi }, testInfo) => {
    await mockApi("planner-factories-trees");
    await page.goto("/app/planner");
    const svg = await openPlate(page);
    await expect(svg.locator("[data-frame]")).toHaveCount(1);
    await page.getByRole("button", { name: "Collapse 5× Constructor, Iron Plate, tree 1 of 2" }).focus();
    await page.keyboard.press("Enter");
    await expect(svg.locator("[data-frame]")).toHaveCount(0);
    await expect(svg.getByText("2 groups · tree 1 of 2")).toBeVisible();
    await page.getByRole("button", { name: "5× Constructor, Iron Plate, tree 1 of 2" }).focus();
    await page.keyboard.press("Enter");
    await expect(svg.locator("[data-frame]")).toHaveCount(1);
    await expect(svg.locator("[style]")).toHaveCount(0);
    await expectNoAxeViolations(page, testInfo);
  });
});

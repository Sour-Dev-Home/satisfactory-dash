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
  // dagre has laid out the cards, and the edge labels are drawn: the item as its icon bubble over the rate (ADR-0060;
  // the <title> tooltip keeps the words).
  const ironOre = svg.locator('[data-edge-label]:has([data-bubble="Desc_OreIron_C"])').first();
  await expect(ironOre.locator('[data-bubble] image[href$="-32.webp"], [data-bubble] image[href$="-64.webp"]')).toBeVisible();
  await expect(ironOre.locator(":scope > text", { hasText: /^120 items\/min$/ })).toBeVisible();

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
  await page.getByRole("combobox", { name: "Item" }).selectOption({ label: "Iron Ore" });
  await expect(page.getByRole("status")).toContainText("groups carry or feed this item");
  await page.getByRole("combobox", { name: "Item" }).selectOption({ label: "All items" });
  await expect(page.getByRole("status")).toHaveCount(0);

  // The group panel: Enter on a group's button opens it, Escape closes it and returns focus to the group.
  const group = page.getByRole("button", { name: /^8× Constructor, Iron Plate/ });
  await group.focus();
  await page.keyboard.press("Enter");
  const panel = page.getByRole("complementary", { name: /^8× Constructor, Iron Plate/ });
  await expect(panel).toBeVisible();
  await expect(panel.getByRole("list", { name: /^Machines in / }).getByRole("listitem")).toHaveCount(8);
  await expect(panel.getByText("Underfed · Clock 150%")).toBeVisible();
  await expectNoAxeViolations(page, testInfo);
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
  await expect(group).toBeFocused();

  // The same panel by pointer: click the card in the picture, after Fit to view (the pans above moved it out of
  // sight, and the fit no longer shrinks the drawing below a readable zoom; it starts at the left, the extractors).
  // The card by its tooltip words (it prints an icon, a count and one line).
  await page.getByRole("button", { name: "Fit to view" }).click();
  await svg.locator("g[data-card]", { has: page.locator("title", { hasText: /^Miner Mk\.2\./ }) }).click();
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
  await page.getByRole("combobox", { name: "Item" }).selectOption({ label: "Iron Ingot" });
  await expect(page.getByRole("status")).toContainText("4 of 5 groups carry or feed this item");
  // The recycler (its card) and nothing else of the cards is faded; the edges that miss the item are too.
  await expect(svg.locator("g.opacity-graph-dim", { has: page.locator("title", { hasText: "Iron Plate Recycle" }) }).first()).toBeAttached();
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
    // Only the edges in view move (on a phone most of the four lie past the fitted canvas), so at least one does.
    await expect.poll(() => svg.locator("animateMotion").count()).toBeGreaterThanOrEqual(1);
    await expect(svg.locator("[style]")).toHaveCount(0);
    await expectNoAxeViolations(page, testInfo);

    await page.getByLabel("Motion").selectOption("off");
    await expect(svg.locator("animateMotion")).toHaveCount(0);
    expect(await page.evaluate(() => window.localStorage.getItem("planner.motion"))).toBe("off");
    // The opened factory is in the address (?open=), so a reload comes back to it.
    await page.reload();
    await expect(page).toHaveURL(/[?&]open=/);
    await page.getByRole("button", { name: "Graph" }).click();
    const again = page.getByRole("img", { name: /^Graph of Iron Plate factory/ });
    await expect(again).toBeVisible();
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
    await expect.poll(() => svg.locator("animateMotion").count()).toBeGreaterThanOrEqual(1);
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
    await expect(page.getByRole("button", { name: /1 flow to storage/ })).toHaveCount(1);
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
    await expect(page.getByRole("button", { name: /2 groups · tree 1 of 2/ })).toHaveCount(1);
    await page.getByRole("button", { name: "5× Constructor, Iron Plate, tree 1 of 2" }).focus();
    await page.keyboard.press("Enter");
    await expect(svg.locator("[data-frame]")).toHaveCount(1);
    await expect(svg.locator("[style]")).toHaveCount(0);
    await expectNoAxeViolations(page, testInfo);
  });
});

// ADR-0055 PR 10a: the text form of the lasso, by keyboard alone: tick a group, "Designate selected", name it, Enter.
test("an owner designates a factory's groups from the keyboard", async ({ page, mockApi }, testInfo) => {
  await mockApi("planner-designations");
  await page.goto("/app/planner");
  const press = async (name: string | RegExp, role: "button" | "checkbox" = "button", key = "Enter") => {
    await page.getByRole(role, { name }).focus();
    await page.keyboard.press(key);
  };
  await press("Open factory: Iron Plate factory");
  await press("Tables");
  await press("Select Smelter", "checkbox", "Space");
  await expect(page.getByText("1 group, 4 machines selected")).toBeVisible();
  await press("Designate selected");
  // The name field takes focus, so typing and Enter are the whole of it.
  await expect(page.getByRole("textbox", { name: "Name" })).toBeFocused();
  await expectNoAxeViolations(page, testInfo);
  const sent = page.waitForRequest((r) => r.method() === "POST" && r.url().includes("/planner/designations"));
  await page.keyboard.type("Smelter row");
  await page.keyboard.press("Enter");
  const body = (await sent).postDataJSON() as { name: string; mode: string; members: { id: string; c: string }[] };
  expect(body).toMatchObject({ name: "Smelter row", mode: "core" });
  expect(body.members).toHaveLength(4);
  expect(body.members.every((m) => m.c === "Build_SmelterMk1_C")).toBe(true);
  await expect(page.getByRole("form", { name: "Name the designated factory" })).toHaveCount(0);
});

// ADR-0055 #727: merge two factories and split them back, by keyboard alone, under the production CSP: tick both cards,
// Merge into one, Enter on the proposed name; the undo offer takes the focus, Enter on Split back sends the inverse.
test("an owner merges two factories and splits them back from the keyboard", async ({ page, mockApi }, testInfo) => {
  await mockApi("planner-merge-split");
  await page.goto("/app/planner");
  const press = async (name: string | RegExp, role: "button" | "checkbox" = "button", key = "Enter") => {
    await page.getByRole(role, { name, exact: typeof name === "string" }).focus();
    await page.keyboard.press(key);
  };
  await press("Tables");
  await press("Select Rod works", "checkbox", "Space");
  await press("Select Iron Plate factory", "checkbox", "Space");
  await expect(page.getByText("2 factories selected")).toBeVisible();
  await expectNoAxeViolations(page, testInfo);
  await press("Merge into one");
  // The name field takes focus with the largest factory's name proposed.
  const field = page.getByRole("textbox", { name: "Name" });
  await expect(field).toBeFocused();
  await expect(field).toHaveValue("Iron Plate factory");
  const merged = page.waitForRequest((r) => r.method() === "POST" && r.url().endsWith("/planner/designations/replace"));
  await page.keyboard.press("Enter");
  const mergeBody = (await merged).postDataJSON() as { expect: { id: string; revision: number }[]; put: { id?: string; members: unknown[] }[]; intent: string };
  expect(mergeBody.intent).toBe("merge");
  expect(mergeBody.expect).toEqual([{ id: "6f1c2a9e-3b7d-4e58-9a41-0c5d8e2f7b10", revision: 2 }]);
  expect(mergeBody.put).toHaveLength(1);
  expect(mergeBody.put[0]!.id).toBe("6f1c2a9e-3b7d-4e58-9a41-0c5d8e2f7b10");

  // The undo offer has the focus: Enter is Split back, with the revision the merge answered.
  const splitBack = page.getByRole("button", { name: "Split back" });
  await expect(splitBack).toBeFocused();
  await expectNoAxeViolations(page, testInfo);
  const undone = page.waitForRequest((r) => r.method() === "POST" && r.url().endsWith("/planner/designations/replace"));
  await page.keyboard.press("Enter");
  const undoBody = (await undone).postDataJSON() as { expect: { id: string; revision: number }[]; put: { id: string; createdAt: string }[]; intent: string };
  expect(undoBody.intent).toBe("undo");
  expect(undoBody.expect).toEqual([{ id: "6f1c2a9e-3b7d-4e58-9a41-0c5d8e2f7b10", revision: 3 }]);
  expect(undoBody.put).toEqual([expect.objectContaining({ id: "6f1c2a9e-3b7d-4e58-9a41-0c5d8e2f7b10", createdAt: "2026-10-20T10:00:00.000Z" })]);
  await expect(page.getByText("Split back: the factories are as they were.").first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "Production planner" })).toBeFocused();
});

// ADR-0055 PR 10b: the canvas lasso, by pointer, under the production CSP.
test("an owner lassos a factory's cards on the canvas and designates them", async ({ page, mockApi }, testInfo) => {
  await mockApi("planner-designations");
  await page.goto("/app/planner");
  await page.getByRole("button", { name: "Graph" }).click();
  const overview = page.getByRole("img", { name: /^Graph of Factories/ });
  await expect(overview).toBeVisible();

  // On the canvas, a factory's button is the keyboard's (visually hidden): focus it and press Enter.
  await page.getByRole("button", { name: /^Open factory: Iron Plate factory/ }).focus();
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "Graph" }).click();
  const svg = page.getByRole("img", { name: /^Graph of Iron Plate factory/ });
  await expect(svg).toBeVisible();
  await page.getByRole("button", { name: "Select" }).click();
  // A lasso just inside the canvas's border encloses every card the fit shows. Focusing the factory's button may have
  // scrolled the page, so bring the canvas's top into view first: a press above the viewport reaches nothing.
  await svg.evaluate((el) => el.scrollIntoView({ block: "start" }));
  const box = (await svg.boundingBox())!;
  const at = (fx: number, fy: number) => ({ x: box.x + 4 + fx * (box.width - 8), y: box.y + 4 + fy * (box.height - 8) });
  const corners = [at(0, 0), at(1, 0), at(1, 1), at(0, 1)];
  const before = await transformOf(svg);
  await page.mouse.move(corners[0]!.x, corners[0]!.y);
  await page.mouse.down();
  for (const c of corners.slice(1)) await page.mouse.move(c.x, c.y, { steps: 6 });
  await expect(svg.locator("[data-lasso]")).toHaveCount(1);
  await page.mouse.up();
  await expect(svg.locator("[data-lasso]")).toHaveCount(0);
  expect(await transformOf(svg)).toBe(before);
  await expect(svg.locator("[data-picked]").first()).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: /selected$/ })).toBeVisible();
  await expect(svg.locator("[style]")).toHaveCount(0);
  await expectNoAxeViolations(page, testInfo);

  await page.getByRole("button", { name: "Designate selected" }).click();
  const sent = page.waitForRequest((r) => r.method() === "POST" && r.url().includes("/planner/designations"));
  await page.keyboard.type("Plate works");
  await page.keyboard.press("Enter");
  const body = (await sent).postDataJSON() as { name: string; mode: string; members: unknown[] };
  expect(body).toMatchObject({ name: "Plate works", mode: "core" });
  expect(body.members.length).toBeGreaterThan(0);
});

test("with the item-focus flag on, the keyboard focuses a link's item and Escape leaves it (ADR-0060 build PR 3)", async ({ page, mockApi }, testInfo) => {
  // The flag is off by default and has no control: the owner turns it on in this browser for the review (build PR 6).
  await page.addInitScript(() => window.localStorage.setItem("planner.itemFocus", "on"));
  await mockApi("planner-group-panel");
  await page.goto("/app/planner");
  await page.getByRole("button", { name: "Open site: Iron Plate site" }).click();
  await page.getByRole("button", { name: "Graph" }).click();
  const svg = page.getByRole("img", { name: /^Graph of Iron Plate site/ });
  await expect(svg).toBeVisible();
  // One tab stop for every bubble; the arrow keys move between them, not the view.
  const bubbles = page.getByRole("list", { name: "Items on the lines" }).getByRole("button");
  await expect(bubbles.and(page.locator('[tabindex="0"]'))).toHaveCount(1);
  const before = await transformOf(svg);
  await bubbles.first().focus();
  await page.keyboard.press("ArrowRight");
  await expect(bubbles.nth(1)).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await expect(bubbles.first()).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(bubbles.first()).toHaveAttribute("aria-expanded", "true");
  await expect(svg.locator("[data-focused]")).toHaveCount(1);
  await expect(page.getByRole("status")).toContainText("Focused");
  // The bubble has become its detail card (build PR 5), with its 128 px icon from our own origin (the CSP's img-src).
  const card = svg.locator("[data-item-card]");
  await expect(card).toHaveCount(1);
  await expect(card.locator('image[href$="-128.webp"]')).toHaveCount(1);
  await expect(page.getByRole("group", { name: / card$/ }).getByRole("button", { name: /^Close / })).toBeAttached();
  await expectNoAxeViolations(page, testInfo);
  await page.keyboard.press("Escape");
  await expect(svg.locator("[data-focused]")).toHaveCount(0);
  await expect(card).toHaveCount(0);
  await expect(bubbles.first()).toBeFocused();
  await expect(page.getByRole("status")).toContainText("Overview");
  // Focus does not zoom (owner answer 2); reaching a bubble may only pan it into view.
  expect(/scale\(([\d.e-]+)\)/.exec(await transformOf(svg))?.[1]).toBe(/scale\(([\d.e-]+)\)/.exec(before)?.[1]);
  await expect(svg.locator("[style]")).toHaveCount(0);
});

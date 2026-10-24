import type { Locator } from "@playwright/test";
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
  await expect(svg.getByText("Iron Ore · 120 items/min")).toBeVisible();

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

  // The same panel by pointer: click the card in the picture.
  await svg.getByText("Miner Mk.2").click();
  await expect(page.getByRole("complementary", { name: "Miner Mk.2" })).toBeVisible();
  await page.getByRole("button", { name: "Close" }).click();
  await expect(page.getByRole("complementary")).toHaveCount(0);

  // The tables are one press away and hold the same site.
  await page.getByRole("button", { name: "Tables" }).click();
  await expect(page.getByRole("heading", { name: "Connections" })).toBeVisible();
  await expect(svg).toHaveCount(0);
});

test("the Planner is a tab, after Factory", async ({ page, mockApi }) => {
  await mockApi("default");
  await page.goto("/app");
  const nav = page.getByRole("navigation", { name: "Main" });
  await expect(nav.getByRole("link", { name: "Planner" })).toBeVisible();
  const labels = await nav.getByRole("link").allTextContents();
  expect(labels.indexOf("Planner")).toBe(labels.indexOf("Factory") + 1);
});

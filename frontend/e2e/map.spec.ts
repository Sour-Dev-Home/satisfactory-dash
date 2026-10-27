import type { Page } from "@playwright/test";
import { expect, expectNoAxeViolations, test } from "./fixtures";

// ADR-0023's gate for adopting Leaflet: pan, zoom, marker hover and a layer toggle, all with
// zero CSP violations (the guards fixture fails the test on any) under the production CSP.

/**
 * A marker's centre in page coordinates, found by its colour on the map canvas (markers
 * aren't DOM). The centre, not the first pixel found: Leaflet's hit test is the circle.
 */
async function findMarker(page: Page): Promise<{ x: number; y: number }> {
  let point: { x: number; y: number } | null = null;
  // The canvas draws on the next animation frame after the data arrives: poll for it.
  await expect.poll(async () => (point = await markerOnCanvas(page)), { message: "a producing building's marker on the canvas" }).not.toBeNull();
  return point!;
}

function markerOnCanvas(page: Page) {
  return page.evaluate(() => {
    const hex = getComputedStyle(document.documentElement).getPropertyValue("--color-ok").trim();
    const want = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    for (const canvas of document.querySelectorAll<HTMLCanvasElement>(".map-canvas canvas")) {
      const { data, width, height } = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height);
      const rect = canvas.getBoundingClientRect();
      const map = canvas.closest(".map-canvas")!.getBoundingClientRect();
      const matches = (x: number, y: number) => {
        const i = (y * width + x) * 4;
        return want.every((c, k) => Math.abs(data[i + k] - c) < 8);
      };
      const toPage = (x: number, y: number) => ({
        x: rect.left + (x * rect.width) / width,
        y: rect.top + (y * rect.height) / height,
      });
      for (let y = 0; y < height; y += 2) {
        for (let x = 0; x < width; x += 2) {
          if (!matches(x, y)) continue;
          // Only a marker inside the visible map (the canvas is padded past its edges), clear
          // of the zoom buttons in the top-left corner.
          const p = toPage(x, y);
          if (p.x < map.left + 70 || p.x > map.right - 10 || p.y < map.top + 10 || p.y > map.bottom - 10) continue;
          // The centroid of the matching pixels near this one: inside the housing (icons are 20-40 px
          // across, by zoom), so inside its hit circle.
          let sx = 0, sy = 0, n = 0;
          for (let dy = 0; dy <= 16; dy++) {
            for (let dx = -8; dx <= 8; dx++) {
              if (!matches(x + dx, y + dy)) continue;
              sx += x + dx;
              sy += y + dy;
              n++;
            }
          }
          return toPage(sx / n, sy / n);
        }
      }
    }
    return null;
  });
}

test("pan, zoom, hover and layer toggle work under the strict CSP", async ({ page, mockApi }, testInfo) => {
  await mockApi("default");
  await page.goto("/app/map");
  const map = page.getByRole("application", { name: /Factory map/ });
  await expect(map).toBeVisible();
  await expect(page.getByRole("table", { name: /Buildings in view/ })).toBeVisible();
  await expect(page.getByText(/^5 buildings on the map:/)).toBeVisible();

  // Hover: the tooltip is text built from DOM nodes.
  let marker = await findMarker(page);
  await page.mouse.move(marker.x, marker.y);
  await expect(page.locator(".leaflet-tooltip")).toBeVisible();

  // Zoom with the button and the wheel, then pan by dragging.
  await page.getByRole("button", { name: "Zoom in" }).click();
  await page.mouse.move(marker.x, marker.y);
  await page.mouse.wheel(0, 300);
  const box = (await map.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 120, box.y + box.height / 2 + 60, { steps: 10 });
  await page.mouse.up();

  // Keyboard: the map takes focus and pans with the arrow keys.
  await map.focus();
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("Minus");

  // Layer toggle: off removes the markers and the list, on brings both back.
  const layer = page.getByRole("checkbox", { name: "Buildings" });
  await layer.uncheck();
  await expect(page.getByRole("heading", { name: /Buildings in view/ })).toHaveCount(0);
  await layer.check();
  await expect(page.getByRole("heading", { name: /Buildings in view/ })).toBeVisible();
  marker = await findMarker(page);
  expect(marker.x).toBeGreaterThan(0);

  await expectNoAxeViolations(page, testInfo);
});

/** Whether any pixel on the map's canvases is this design token's colour. */
const tokenOnCanvas = (page: Page, tokenName: string) =>
  page.evaluate((name) => {
    const hex = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    const want = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    for (const canvas of document.querySelectorAll<HTMLCanvasElement>(".map-canvas canvas")) {
      const { data } = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height);
      for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] > 0 && want.every((c, k) => Math.abs(data[i + k] - c) < 8)) return true;
      }
    }
    return false;
  }, tokenName);

/** How many resource-node icons (#571) have finished loading a real image. */
const loadedNodeIcons = (page: Page) =>
  page.evaluate(() => [...document.querySelectorAll<HTMLImageElement>(".node-icon img")].filter((img) => img.complete && img.naturalWidth > 0).length);

// ADR-0038 M5: the rails and resource nodes are the data-derived base map. Drawn on the canvas, and
// also text, and each layer's toggle removes what it drew (the CSP gate above covers pan and zoom).
test("the world layers draw, read as text, and toggle", async ({ page, mockApi }, testInfo) => {
  await mockApi("default");
  await page.goto("/app/map");
  await expect(page.getByText(/^1 rail segment on the map/)).toBeVisible();
  await expect(page.getByText(/^7 resource nodes on the map \(2 in use\)/)).toBeVisible();
  await expect(page.getByRole("table", { name: /Rail segments in view/ })).toBeVisible();
  await expect(page.getByRole("table", { name: /Resource nodes in view/ })).toBeVisible();
  // #571: every fixture node is a known resource, so each is its game icon (an <img> marker), none a canvas circle.
  // Loaded, not just present: a CSP or path mistake leaves a broken image with naturalWidth 0.
  await expect.poll(() => loadedNodeIcons(page), { message: "resource icons loaded" }).toBe(7);

  await page.getByRole("checkbox", { name: "Resource nodes" }).uncheck();
  await expect(page.getByRole("table", { name: /Resource nodes in view/ })).toHaveCount(0);
  await expect(page.locator(".node-icon img")).toHaveCount(0);
  await expect.poll(() => tokenOnCanvas(page, "--color-node"), { message: "no nodes after the toggle" }).toBe(false);
  await page.getByRole("checkbox", { name: "Resource nodes" }).check();
  await expect(page.getByRole("table", { name: /Resource nodes in view/ })).toBeVisible();

  await expectNoAxeViolations(page, testInfo);
});

// ADR-0038 M6: the live trains. Drawn on the canvas (a dot per train, a ring per station), also text,
// and the toggle removes what they drew. The tooltip is built from text nodes (the CSP gate above covers hover).
test("the live trains draw, read as text, and toggle", async ({ page, mockApi }, testInfo) => {
  await mockApi("default");
  await page.goto("/app/map");
  await expect(page.getByText("1 train and 2 stations on the map.")).toBeVisible();
  await expect(page.getByRole("table", { name: /Trains in view \(1\)/ })).toBeVisible();
  await expect(page.getByRole("table", { name: /Train stations in view \(2\)/ })).toBeVisible();
  await expect.poll(() => tokenOnCanvas(page, "--color-train"), { message: "a train drawn" }).toBe(true);
  await expect.poll(() => tokenOnCanvas(page, "--color-station"), { message: "a station drawn" }).toBe(true);

  await page.getByRole("checkbox", { name: "Trains" }).uncheck();
  await expect(page.getByRole("table", { name: /Trains in view/ })).toHaveCount(0);
  await expect.poll(() => tokenOnCanvas(page, "--color-train"), { message: "no train after the toggle" }).toBe(false);
  await expect.poll(() => tokenOnCanvas(page, "--color-station"), { message: "no station after the toggle" }).toBe(false);
  await page.getByRole("checkbox", { name: "Trains" }).check();
  await expect(page.getByRole("table", { name: /Trains in view \(1\)/ })).toBeVisible();

  await expectNoAxeViolations(page, testInfo);
});

// ADR-0038 §1 (#330): the players' map markers and stamps. Text and table, and the toggle removes them (whether
// a shape is on the canvas depends on the first view, which fits the buildings, so the unit tests cover the drawing).
test("the map markers read as text and toggle", async ({ page, mockApi }, testInfo) => {
  await mockApi("default");
  await page.goto("/app/map");
  await expect(page.getByText("1 marker and 3 stamps on the map.")).toBeVisible();
  const table = page.getByRole("table", { name: /Markers in view/ });
  await expect(table).toBeVisible();
  await page.getByRole("checkbox", { name: "Markers" }).uncheck();
  await expect(table).toHaveCount(0);
  await expect(page.getByText("1 marker and 3 stamps on the map.")).toHaveCount(0);
  await page.getByRole("checkbox", { name: "Markers" }).check();
  await expect(page.getByRole("table", { name: /Markers in view/ })).toBeVisible();

  await expectNoAxeViolations(page, testInfo);
});

// ADR-0055 Decision 1 (#330): the drone ports, on by default. Text and table, and the toggle removes them and stops the
// read (whether a square is on the canvas depends on the first view, which fits the buildings; the unit tests cover it).
test("the drone ports read as text and toggle", async ({ page, mockApi }, testInfo) => {
  await mockApi("default");
  await page.goto("/app/map");
  await expect(page.getByText("3 drone ports, 1 route on the map.")).toBeVisible();
  const toggle = page.getByRole("checkbox", { name: "Drone ports" });
  await expect(toggle).toBeChecked();
  await expect(page.getByRole("table", { name: /Drone ports in view/ }).or(page.getByRole("heading", { name: "Drone ports in view (0)" }))).toBeVisible();
  await expectNoAxeViolations(page, testInfo);

  await toggle.uncheck();
  await expect(page.getByText("3 drone ports, 1 route on the map.")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: /Drone ports in view/ })).toHaveCount(0);
  await toggle.check();
  await expect(page.getByText("3 drone ports, 1 route on the map.")).toBeVisible();
});

// ADR-0038 §1 (#330): the power lines are off by default and asked for only once toggled on. On, they read as a count
// and a table (the canvas pixels depend on the first view, which fits the buildings; the unit tests cover the path).
test("the power lines are off by default, then read as text and toggle", async ({ page, mockApi }, testInfo) => {
  const asked: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/map/world/powerLines")) asked.push(request.url());
  });
  await mockApi("default");
  await page.goto("/app/map");
  await expect(page.getByText("1 marker and 3 stamps on the map.")).toBeVisible();
  const toggle = page.getByRole("checkbox", { name: "Power lines" });
  await expect(toggle).not.toBeChecked();
  expect(asked, "power lines asked for while off").toEqual([]);

  await toggle.check();
  await expect(page.getByText("2 power lines on the map, 243 m of wire in all.")).toBeVisible();
  await expect(page.getByRole("table", { name: /Power lines in view/ }).or(page.getByRole("heading", { name: "Power lines in view (0)" }))).toBeVisible();
  await expectNoAxeViolations(page, testInfo);

  await toggle.uncheck();
  await expect(page.getByText(/power lines on the map/)).toHaveCount(0);
  await expect(page.getByRole("heading", { name: /Power lines in view/ })).toHaveCount(0);
});

// #330: the belts, lifts and pipes are off by default (thousands on a big save) and asked for only once toggled on. On,
// they draw three more canvas paths under the buildings (the CSP gate: no violation, no unmocked call) and read as text.
test("the belts and pipes are off by default, then draw and read as text, and toggle", async ({ page, mockApi }, testInfo) => {
  const asked: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/map/world/conveyors")) asked.push(request.url());
  });
  await mockApi("default");
  await page.goto("/app/map");
  await expect(page.getByText("1 marker and 3 stamps on the map.")).toBeVisible();
  const toggle = page.getByRole("checkbox", { name: "Belts and pipes" });
  await expect(toggle).not.toBeChecked();
  expect(asked, "conveyors asked for while off").toEqual([]);

  await toggle.check();
  const summary = page.getByText(/^7 belts, 2 pipes, 2 lifts on the map, 30 m of belt measured, pipe length unknown, drawn straight between their ends\./);
  await expect(summary).toBeVisible();
  await expect(page.getByText("Belt or pipe, far end not placed")).toBeVisible();
  await expect(
    page.getByRole("table", { name: /Belts, lifts and pipes in view/ }).or(page.getByRole("heading", { name: "Belts, lifts and pipes in view (0)" })),
  ).toBeVisible();
  await expectNoAxeViolations(page, testInfo);

  await toggle.uncheck();
  await expect(summary).toHaveCount(0);
  await expect(page.getByRole("heading", { name: /Belts, lifts and pipes in view/ })).toHaveCount(0);
});

test.describe("the map's first view", () => {
  // Reduced motion also turns off Leaflet's zoom and fade animations, so the screenshot is stable.
  test.use({ reducedMotion: "reduce" });

  test("the map's first view", async ({ page, mockApi }) => {
    await mockApi("default");
    await page.goto("/app/map");
    await expect(page.getByRole("table", { name: /Buildings in view/ })).toBeVisible();
    await findMarker(page);
    await expect(page).toHaveScreenshot("map.png", { fullPage: true });
  });
});

/** Everything the map's canvas shows right now, as one string to compare. */
const canvasPixels = (page: Page) =>
  page.evaluate(() => [...document.querySelectorAll<HTMLCanvasElement>(".map-canvas canvas")].map((c) => c.toDataURL()).join());

// A backed-up machine's ring (the default scenario has two) is still, with or without reduced motion.
for (const motion of ["no-preference", "reduce"] as const) {
  test.describe(`motion ${motion}`, () => {
    test.use({ reducedMotion: motion });

    test("a backed-up machine's ring holds still", async ({ page, mockApi }) => {
      await mockApi("default");
      await page.goto("/app/map");
      await findMarker(page);
      const first = await canvasPixels(page);
      await page.waitForTimeout(400);
      expect(await canvasPixels(page)).toBe(first);
    });
  });
}

// #434: Leaflet's panes (z-index 200-800) must stay inside the map's own stacking context, or
// they paint over the header's popovers (--z-popover) and the grid shows through the alerts panel.
// The popover hangs from the bell and scrolls with the page, so how far it reaches over the map
// depends on its height, not on scrolling: the "alerts" scenario (a firing alert and a page of
// events) makes it tall enough to cover the map's top at 390 px, whatever the toggle rows above
// the map add. Every default-on layer (drone ports included) is drawn under it.
test("the alerts popover paints above every map layer", async ({ page, mockApi }) => {
  await mockApi("alerts");
  await page.goto("/app/map");
  const map = page.getByRole("application", { name: /Factory map/ });
  await expect(map).toBeVisible();
  await findMarker(page);

  const bell = page.getByRole("button", { name: /^Alerts/ });
  await bell.click();
  const panelId = await bell.getAttribute("aria-controls");
  const panel = page.locator(`[id="${panelId}"]`);
  await expect(panel).toBeVisible();

  const result = await page.evaluate((id) => {
    const popover = document.getElementById(id)!.getBoundingClientRect();
    const mapRect = document.querySelector(".map-canvas")!.getBoundingClientRect();
    const misses: string[] = [];
    let overMap = 0;
    // A 5x5 grid of points inside the popover, clear of its border.
    for (let i = 1; i <= 5; i++) {
      for (let j = 1; j <= 5; j++) {
        const x = popover.left + (popover.width * i) / 6;
        const y = popover.top + (popover.height * j) / 6;
        if (x >= mapRect.left && x <= mapRect.right && y >= mapRect.top && y <= mapRect.bottom) overMap++;
        const hit = document.elementFromPoint(x, y);
        if (!hit || !hit.closest(`[id="${id}"]`)) misses.push(`${Math.round(x)},${Math.round(y)}: ${hit?.className || hit?.tagName}`);
      }
    }
    return { overMap, misses };
  }, panelId!);

  expect(result.overMap, "points of the popover over the map").toBeGreaterThan(0);
  expect(result.misses, "points inside the popover hit something else").toEqual([]);
});

test("Leaflet loads only with the Map page, not with the app", async ({ page, mockApi }) => {
  const mapChunks: string[] = [];
  page.on("request", (request) => {
    if (/\/assets\/MapCanvas-[^/]+\.js$/.test(request.url())) mapChunks.push(request.url());
  });
  await mockApi("default");
  await page.goto("/app");
  await expect(page.getByRole("list", { name: "Sections" })).toBeVisible();
  expect(mapChunks, "map chunk requested on the Overview").toEqual([]);
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Map" }).click();
  await expect(page.getByRole("application", { name: /Factory map/ })).toBeVisible();
  expect(mapChunks).toHaveLength(1);
});

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
          // The centroid of this marker's matching pixels (markers are 12 px across).
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

test("the map's first view", async ({ page, mockApi }) => {
  await mockApi("default");
  await page.goto("/app/map");
  await expect(page.getByRole("table", { name: /Buildings in view/ })).toBeVisible();
  await findMarker(page);
  await expect(page).toHaveScreenshot("map.png", { fullPage: true });
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

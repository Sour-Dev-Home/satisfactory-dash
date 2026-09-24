import { powerHistoryNormal, powerOk } from "@satisfactory-dash/shared/fixtures";
import { expect, test } from "./fixtures";

// ADR-0022's condition for adopting uPlot: the chart renders, shows its hover crosshair,
// resizes and takes new data with zero CSP violations. The guards fixture fails the test on
// any violation, so each step below runs under the production CSP (style-src 'self').

test("the live power chart renders, hovers, resizes and appends under the strict CSP", async ({ page, mockApi }) => {
  await mockApi("default");
  await page.goto("/app/power");

  const chart = page.getByRole("article", { name: "Circuit 0 history" });
  const plot = chart.locator(".power-chart .u-over");
  await expect(plot).toBeVisible();
  await expect(chart.locator(".power-chart canvas")).toHaveCount(1);
  // The lines are actually drawn: the canvas holds production-green pixels. (A chart with a
  // grid and legend but no lines once passed everything else here.)
  await expect
    .poll(() =>
      chart.locator(".power-chart canvas").evaluate((canvas: HTMLCanvasElement) => {
        const d = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data;
        let green = 0;
        for (let i = 0; i < d.length; i += 4) if (d[i + 1] > 150 && d[i] < 120 && d[i + 2] < 150) green++;
        return green;
      }),
    )
    .toBeGreaterThan(100);

  // Hover: uPlot shows its crosshair and puts the values under the cursor in the legend.
  const box = (await plot.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await expect(chart.locator(".u-cursor-x")).toBeVisible();
  await expect(chart.locator(".u-legend .u-value").nth(1)).toContainText("3,");

  // Resize: the chart follows its container, both ways, and never overflows the page.
  const canvasWidth = async () => (await chart.locator(".power-chart canvas").boundingBox())!.width;
  const before = await canvasWidth();
  const viewport = page.viewportSize()!;
  const resized = viewport.width > 600 ? 600 : 800;
  await page.setViewportSize({ width: resized, height: viewport.height });
  await expect.poll(canvasWidth).not.toBe(before);
  expect(await canvasWidth()).toBeLessThanOrEqual(resized);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(resized);

  // The readings table scrolls in its own box: opening it never widens the page.
  await chart.getByText("Readings table").click();
  await expect(chart.getByRole("table")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(resized);

  // Append: a newer regular power poll lands on the chart without refetching the history.
  const last = powerHistoryNormal.data.series[0].points.at(-1)!;
  const newer = {
    ...powerOk,
    observedAt: new Date(last.t + 10_000).toISOString(),
    data: { ...powerOk.data, circuits: [{ ...powerOk.data.circuits[0], productionMW: 1234.5 }] },
  };
  await page.route("**/api/servers/*/power", (route) => route.fulfill({ json: newer }));
  // TanStack Query refetches on focus from a `visibilitychange` on window.
  await page.evaluate(() => window.dispatchEvent(new Event("visibilitychange")));
  await expect(chart.getByText("1,234.5 MW").first()).toBeVisible();
});

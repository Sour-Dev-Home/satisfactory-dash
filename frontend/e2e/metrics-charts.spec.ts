import { expect, test } from "./fixtures";

// ADR-0056 amendment 2026-10-26: the metrics page's trend charts are one lazy chunk (TrendChart, uPlot), loaded once for
// all seven charts and only on that page, drawn under the strict CSP (the guards fixture fails on any violation), with
// a hover legend that reads the bucket bound, never a drawn 10 s.

test("the metrics charts load one chunk, only on the metrics page, and draw under the strict CSP", async ({ page, mockApi }) => {
  const chunks: string[] = [];
  page.on("request", (request) => {
    if (/\/assets\/TrendChart-[^/]+\.js$/.test(request.url())) chunks.push(request.url());
  });
  await mockApi("metrics");
  await page.goto("/app");
  await expect(page.getByRole("list", { name: "Sections" })).toBeVisible();
  expect(chunks, "chart chunk requested on the Overview").toEqual([]);

  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Metrics" }).click();
  await expect(page.locator(".trend-chart canvas")).toHaveCount(7);
  expect(chunks).toHaveLength(1);

  // Hover the latency chart: the legend shows bucket bounds in words.
  const latency = page.getByRole("figure", { name: "Request latency" });
  const over = latency.locator(".u-over");
  await over.scrollIntoViewIfNeeded();
  const box = await over.boundingBox();
  if (!box) throw new Error("the latency chart has no plot area");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await expect(latency.locator(".u-legend")).toContainText(/≤ \d+ m?s|> 5 s|No data/);
});

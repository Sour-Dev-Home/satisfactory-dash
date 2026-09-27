import { expect, test } from "./fixtures";

// A tab open across a deploy (#325): the chart chunk it asks for is gone, and the hosting's SPA
// fallback answers with index.html (200 text/html), so the import fails. The page reloads once;
// if the chunk is still missing after that, the section asks for a reload instead of looping.
test("a missing lazy chunk reloads the page once, then asks for a reload", async ({ page, mockApi }) => {
  let stale = true;
  await page.route(/\/assets\/PowerChart-[^/]+\.js$/, async (route) => {
    if (!stale) return route.fallback();
    return route.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><title>index</title>" });
  });
  let loads = 0;
  page.on("load", () => loads++);

  await mockApi("default");
  await page.goto("/app");
  await expect(page.getByRole("list", { name: "Sections" })).toBeVisible();
  expect(loads).toBe(1);

  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Power" }).click();
  // The reload lands on the Power page, the chunk fails again, and the guard stops a second reload.
  // (The notice also flashes on the first page just before it navigates, so wait for the load.)
  await expect.poll(() => loads).toBe(2);
  const notice = page.getByRole("alert").filter({ hasText: "A new version of the dashboard is available" }).first();
  await expect(notice).toBeVisible();
  await expect(page).toHaveURL(/\/app\/power$/);
  await expect(page.getByRole("button", { name: "Try again" })).toHaveCount(0);
  // No loop: the page stays put with the notice.
  await page.waitForTimeout(1000);
  expect(loads).toBe(2);

  // The new version is there now: Reload shows the chart.
  stale = false;
  await notice.getByRole("button", { name: "Reload" }).click();
  await expect(page.locator(".power-chart canvas").first()).toBeVisible();
  expect(loads).toBe(3);
});

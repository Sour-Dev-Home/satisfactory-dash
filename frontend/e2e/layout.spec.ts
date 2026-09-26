import { expect, test } from "./fixtures";

// The layout must not shift sideways between tabs (the owner's report: switching to Power moved
// everything left). Cause: a classic scrollbar appears only on pages taller than the window,
// and the centred layout moves by half its width. Playwright hides scrollbars by default
// (--hide-scrollbars), which hid the bug, so this test shows them. The window is short enough
// that some tabs scroll and one doesn't, which the test checks, so it can't pass vacuously.
test.use({
  launchOptions: { ignoreDefaultArgs: ["--hide-scrollbars"] },
  viewport: { width: 1440, height: 640 },
});

test("the header and tabs stay put across every tab, scrolling or not", async ({ page, mockApi, isMobile }) => {
  // Phones use overlay scrollbars, and the viewport above replaces the mobile one anyway.
  test.skip(isMobile, "desktop scrollbars only");
  await mockApi("default");
  await page.goto("/app");
  const nav = page.getByRole("navigation", { name: "Main" });
  await nav.waitFor();

  const seen: { tab: string; title: number; tabs: number; scrolls: boolean; scrollbarWidth: number }[] = [];
  for (const tab of ["Overview", "Power", "Factory", "Settings", "Overview"]) {
    await nav.getByRole("link", { name: tab }).click();
    await expect(nav.getByRole("link", { name: tab })).toHaveAttribute("aria-current", "page");
    // Each page's content is what makes it tall: wait for it before measuring.
    await page.waitForLoadState("networkidle");
    if (tab === "Power") await page.locator(".power-chart canvas").first().waitFor();
    seen.push({
      tab,
      title: (await page.getByRole("heading", { level: 1 }).boundingBox())!.x,
      tabs: (await nav.boundingBox())!.x,
      scrolls: await page.evaluate(() => document.documentElement.scrollHeight > window.innerHeight),
      // innerWidth includes a classic scrollbar; clientWidth doesn't.
      scrollbarWidth: await page.evaluate(() => window.innerWidth - document.documentElement.clientWidth),
    });
  }

  // Without a real scrollbar the x checks below pass with or without the fix, so this is a
  // precondition, and a failure, not a skip: a skipped test reads as green and guards nothing.
  expect(
    seen.some((s) => s.scrolls && s.scrollbarWidth > 0),
    `a scrolling tab shows a classic scrollbar (else this test can't see the bug): ${JSON.stringify(seen)}`,
  ).toBe(true);

  expect(seen.some((s) => s.scrolls) && seen.some((s) => !s.scrolls), `some tabs scroll and some don't: ${JSON.stringify(seen)}`).toBe(true);
  expect(new Set(seen.map((s) => s.title)).size, `title x per tab: ${JSON.stringify(seen)}`).toBe(1);
  expect(new Set(seen.map((s) => s.tabs)).size, `tabs x per tab: ${JSON.stringify(seen)}`).toBe(1);
});

// With the operator's sixth tab (Servers), the tabs are wider than a phone: the nav must scroll
// on its own, never the page, and every tab must stay reachable.
test.describe("on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("all six tabs are reachable and the page never scrolls sideways", async ({ page, mockApi }) => {
    await mockApi("servers-manage");
    await page.goto("/app");
    const nav = page.getByRole("navigation", { name: "Main" });
    for (const tab of ["Power", "Factory", "Map", "Settings", "Servers", "Overview"]) {
      await nav.getByRole("link", { name: tab }).click();
      await expect(nav.getByRole("link", { name: tab })).toHaveAttribute("aria-current", "page");
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, `page overflow on ${tab}`).toBeLessThanOrEqual(0);
    }
    // The tabs don't fit, so this proves the nav itself scrolls (the check isn't vacuous).
    expect(await nav.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
  });
});

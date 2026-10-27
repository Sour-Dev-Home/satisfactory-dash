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
  // With the game server unreachable, Power is just two empty panels (short) while Overview, Factory and
  // Settings still scroll at this height. Every tab of the default scenario scrolls once Settings
  // has its Alerts section, so a short page comes from an error, which stays short as pages grow.
  await mockApi("upstream-unreachable");
  await page.goto("/app");
  const nav = page.getByRole("navigation", { name: "Main" });
  await nav.waitFor();

  const seen: { tab: string; title: number; tabs: number; scrolls: boolean; scrollbarWidth: number }[] = [];
  for (const tab of ["Overview", "Power", "Factory", "Settings", "Overview"]) {
    await nav.getByRole("link", { name: tab }).click();
    await expect(nav.getByRole("link", { name: tab })).toHaveAttribute("aria-current", "page");
    // Each page's content is what makes it tall: wait for it before measuring.
    await page.waitForLoadState("networkidle");
    if (tab === "Power") {
      // Said once, by the server banners: the Power panels show a quiet empty panel instead.
      await expect(page.getByText("Game server unreachable.")).toBeVisible();
      await expect(page.getByText("Game server unreachable.")).toHaveCount(1);
    }
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
    for (const tab of ["Power", "Factory", "Map", "Settings", "Servers", "Metrics", "Overview"]) {
      await nav.getByRole("link", { name: tab }).click();
      await expect(nav.getByRole("link", { name: tab })).toHaveAttribute("aria-current", "page");
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, `page overflow on ${tab}`).toBeLessThanOrEqual(0);
    }
    // The tabs don't fit, so this proves the nav itself scrolls (the check isn't vacuous).
    expect(await nav.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
  });

  // The last tab was cut at the right edge in the phone screenshots: scrolled to the end it must sit fully
  // inside the nav and the window, and nothing (a fade mask included) may cover it.
  for (const scenario of ["default", "servers-manage"] as const) {
    test(`the last tab is fully visible once the nav is scrolled to its end (${scenario})`, async ({ page, mockApi }) => {
      await mockApi(scenario);
      await page.goto("/app");
      const nav = page.getByRole("navigation", { name: "Main" });
      await nav.waitFor();
      const overBy = await nav.evaluate((el) => el.scrollWidth - el.clientWidth);
      const overflows = overBy > 1;
      // The six standard tabs fit whole (no scrolling, no fade: the old cut-off "SET"); the operator's seventh scrolls.
      expect(overflows, scenario === "default" ? `the standard tabs fit at 390 px (over by ${overBy}px)` : "the extra tab overflows, so the check is real").toBe(
        scenario !== "default",
      );
      if (!overflows) expect(await nav.evaluate((el) => getComputedStyle(el).maskImage)).toBe("none");
      await nav.evaluate((el) => {
        el.scrollLeft = el.scrollWidth;
      });
      const last = nav.getByRole("link").last();
      await expect(last).toHaveText(scenario === "default" ? /^settings$/i : /^servers$/i);
      await expect.poll(() => nav.evaluate((el) => Math.round(el.scrollLeft + el.clientWidth - el.scrollWidth))).toBe(0);
      const box = await last.boundingBox();
      const navBox = await nav.boundingBox();
      const width = page.viewportSize()?.width ?? 0;
      expect(box && navBox).toBeTruthy();
      expect(box!.x + box!.width, "right edge within the nav").toBeLessThanOrEqual(navBox!.x + navBox!.width + 0.5);
      expect(box!.x + box!.width, "right edge within the window").toBeLessThanOrEqual(width);
      // The fade mask must not reach the last tab: at the end only the start is faded (to the left), or none at all.
      expect(await nav.evaluate((el) => getComputedStyle(el).maskImage)).not.toContain("to right");
      // The first tab's label is still on the page's text edge (16 px) and the page does not scroll sideways.
      if (!overflows) {
        const first = await nav.getByRole("link").first().evaluate((el) => {
          const label = document.createRange();
          label.selectNodeContents(el);
          return label.getBoundingClientRect().x;
        });
        expect(first).toBeGreaterThanOrEqual(15);
      }
    });
  }
});

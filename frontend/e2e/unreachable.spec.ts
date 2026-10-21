import { expectNoAxeViolations, expect, settleAnimations, test } from "./fixtures";

/**
 * The owner's report (2026-10-21): with the game server down, every poll put the never-answered reads
 * back to pending, so skeletons came back, the banner row collapsed and panels "re-popped", and each
 * panel stacked its own "Game server unreachable." notice. Here the game is down from the first
 * request (every game-backed read fails), the page clock runs about 30 s of polls (status every 10 s,
 * factory every 30 s), and after each tick: one notice, no skeleton, the banner where it was.
 */
const UNREACHABLE = "Game server unreachable.";
const STATUS_POLL_MS = 10_000;
const TICKS = 3;
/** The status read (not the alerts' own status). */
const STATUS_URL = /^\/api\/servers\/[^/]+\/status$/;

const PAGES = [
  { name: "Overview", path: "/app" },
  { name: "Power", path: "/app/power" },
  { name: "Factory", path: "/app/factory" },
] as const;

for (const { name, path } of PAGES) {
  test(`unreachable from the start, ${name} holds still through the polls`, async ({ page, mockApi }, testInfo) => {
    await page.clock.install();
    await mockApi("upstream-unreachable");
    await page.goto(path);

    const notice = page.getByText(UNREACHABLE);
    await expect(notice).toBeVisible();
    await expect(notice).toHaveCount(1);
    // Revealed and settled: no skeleton anywhere from here on.
    await expect(page.locator("[data-skeleton]")).toHaveCount(0);
    await settleAnimations(page);
    const banner = page.getByRole("alert").filter({ hasText: UNREACHABLE });
    const before = await banner.boundingBox();
    expect(before).not.toBeNull();

    for (let tick = 1; tick <= TICKS; tick++) {
      const answered = page.waitForResponse((r) => STATUS_URL.test(new URL(r.url()).pathname));
      await page.clock.runFor(STATUS_POLL_MS);
      // While the poll is out: read once, without waiting, so a notice that drops and comes back fails.
      expect(await notice.count(), `tick ${tick}, mid-poll`).toBe(1);
      expect(await page.locator("[data-skeleton]").count(), `tick ${tick}, mid-poll`).toBe(0);
      await answered;
      await expect(notice).toHaveCount(1);
      await expect(page.locator("[data-skeleton]")).toHaveCount(0);
      expect(await banner.boundingBox(), `banner box after tick ${tick}`).toEqual(before);
    }

    await expectNoAxeViolations(page, testInfo);
  });
}

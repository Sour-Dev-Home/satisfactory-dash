import AxeBuilder from "@axe-core/playwright";
import { test as base, expect, type Page, type TestInfo } from "@playwright/test";
import { matchRoute, responsesFor, type ScenarioName } from "../src/test/scenarios";

declare global {
  interface Window {
    __cspViolations?: string[];
  }
}

interface Fixtures {
  /** Answers every /api request from the named scenario (src/test/scenarios.ts). */
  mockApi: (scenario: ScenarioName) => Promise<void>;
  /** Auto: fails the test on any CSP violation (ADR-0016 item 8) or unmocked /api call. */
  guards: void;
}

export const test = base.extend<Fixtures & { unmocked: string[] }>({
  // Playwright's fixture signature: an empty destructure when no other fixture is needed.
  unmocked: async ({}, use) => {
    await use([]);
  },

  guards: [
    async ({ page, unmocked }, use) => {
      await page.addInitScript(() => {
        window.__cspViolations = [];
        document.addEventListener("securitypolicyviolation", (e) => {
          window.__cspViolations?.push(`${e.effectiveDirective} blocked ${e.blockedURI || "inline"}`);
        });
      });
      // Catch-all for tests that never call mockApi: otherwise vite preview proxies /api to
      // whatever backend is on localhost:3001. mockApi's route, registered later, runs first.
      await page.route("**/api/**", (route) => {
        const request = route.request();
        unmocked.push(`${request.method()} ${new URL(request.url()).pathname}`);
        return route.abort();
      });
      const consoleCsp: string[] = [];
      page.on("console", (message) => {
        if (/Content[- ]Security[- ]Policy/i.test(message.text())) consoleCsp.push(message.text());
      });

      await use();

      const events = await page.evaluate(() => window.__cspViolations ?? []).catch(() => [] as string[]);
      expect([...events, ...consoleCsp], "CSP violations (ADR-0016 item 8)").toEqual([]);
      expect(unmocked, "requests to /api with no mock").toEqual([]);
    },
    { auto: true },
  ],

  mockApi: async ({ page, unmocked }, use) => {
    await use(async (scenario) => {
      const responses = responsesFor(scenario);
      await page.route("**/api/**", async (route) => {
        const request = route.request();
        const { pathname } = new URL(request.url());
        const key = matchRoute(request.method(), pathname);
        if (!key) {
          unmocked.push(`${request.method()} ${pathname}`);
          return route.abort();
        }
        const response = responses[key];
        // Left unanswered on purpose: the page stays in its loading state.
        if (response.delay === "never") return;
        if (typeof response.delay === "number") await new Promise((r) => setTimeout(r, response.delay as number));
        if (response.text !== undefined) {
          return route.fulfill({ status: response.status, body: response.text, contentType: "text/html" });
        }
        return route.fulfill({ status: response.status, json: response.body, headers: response.headers });
      });
    });
  },
});

export { expect };

/**
 * Waits for running CSS animations (a page's reveal, a dropdown's pop) to end. Clicking inside
 * something still moving fails Playwright's hit check, and its retry scrolls the element into
 * view, which scrolls the dropdown; axe counts opacity in contrast. Infinite animations (the
 * power card's flowing circuit strip) never finish, so they're skipped rather than awaited.
 */
export async function settleAnimations(page: Page): Promise<void> {
  await page.evaluate(() =>
    Promise.allSettled(
      document
        .getAnimations()
        .filter((a) => a.effect?.getComputedTiming().endTime !== Infinity)
        .map((a) => a.finished),
    ),
  );
}

/** Rounds of `settleAnimations` before giving up on a quiet page, and the pause that lets a late fade start. */
const QUIET_ROUNDS = 10;
const QUIET_PAUSE_MS = 150;

/**
 * Settles animations until a pause starts no new one. A panel whose read answers late (a deploy gap's retries) fades in
 * with its own `animate-reveal` after one settle looked, and axe measured it mid-fade.
 */
async function settleQuiet(page: Page): Promise<void> {
  for (let round = 0; round < QUIET_ROUNDS; round++) {
    await settleAnimations(page);
    await page.waitForTimeout(QUIET_PAUSE_MS);
    const running = await page.evaluate(() => document.getAnimations().filter((a) => a.effect?.getComputedTiming().endTime !== Infinity).length);
    if (running === 0) return;
  }
}

/**
 * Runs axe (WCAG 2.1 A/AA, contrast included) and fails the test on any violation (ADR-0016
 * item 5; failing since step 4). The full result is attached to the report either way.
 */
export async function expectNoAxeViolations(page: Page, testInfo: TestInfo): Promise<void> {
  // A page still waiting to reveal (its reads have not answered: a deploy gap, an outage) fades in once
  // `--duration-reveal-budget` passes, possibly after `settleAnimations` looked. axe then measured its text mid-fade and
  // reported contrast failures at random. Wait for every reveal to start, then for the page to stay still.
  await expect(page.locator('[data-page-reveal="waiting"]')).toHaveCount(0);
  await settleQuiet(page);
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    // axe's preload copies the page's CSS into <style> elements for css-orientation-lock
    // (WCAG 1.3.4), and the strict CSP reports each one, so the CSP guard failed at random,
    // depending on when that report landed. Our CSS has no orientation media queries, so the
    // rule has nothing to find: skip it and the preload. Re-enable both if one is ever added.
    .disableRules(["css-orientation-lock"])
    .options({ preload: false })
    .analyze();
  await testInfo.attach("axe-violations.json", {
    body: JSON.stringify(result.violations, null, 2),
    contentType: "application/json",
  });
  const summary = result.violations.map((v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`);
  expect(summary, "axe WCAG 2.1 AA violations").toEqual([]);
}

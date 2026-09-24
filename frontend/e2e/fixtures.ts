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
        return route.fulfill({ status: response.status, json: response.body });
      });
    });
  },
});

export { expect };

/**
 * Runs axe (WCAG 2.1 A/AA, contrast included) and fails the test on any violation (ADR-0016
 * item 5; failing since step 4). The full result is attached to the report either way.
 */
export async function expectNoAxeViolations(page: Page, testInfo: TestInfo): Promise<void> {
  const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  await testInfo.attach("axe-violations.json", {
    body: JSON.stringify(result.violations, null, 2),
    contentType: "application/json",
  });
  const summary = result.violations.map((v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`);
  expect(summary, "axe WCAG 2.1 AA violations").toEqual([]);
}

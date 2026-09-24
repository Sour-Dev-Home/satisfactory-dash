import AxeBuilder from "@axe-core/playwright";
import { test as base, expect, type Page, type TestInfo } from "@playwright/test";
import { matchRoute, responsesFor, type ScenarioName } from "../src/test/scenarios";

declare global {
  interface Window {
    __cspViolations?: string[];
  }
}

/**
 * The one tolerated violation: zod v4 probes `new Function("")` once to decide whether it may
 * compile fast validators; script-src 'self' blocks it and zod falls back safely. It goes away
 * when packages/shared sets `z.config({ jitless: true })` (a separate contract-owner change);
 * remove this exception then. Anything else blocked by script-src still fails.
 */
function isKnownZodEvalProbe(violation: string): boolean {
  return (
    violation === "script-src blocked eval" ||
    /Refused to evaluate a string as JavaScript because 'unsafe-eval'/.test(violation)
  );
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
      const consoleCsp: string[] = [];
      page.on("console", (message) => {
        if (/Content[- ]Security[- ]Policy/i.test(message.text())) consoleCsp.push(message.text());
      });

      await use();

      const events = await page.evaluate(() => window.__cspViolations ?? []).catch(() => [] as string[]);
      expect([...events, ...consoleCsp].filter((v) => !isKnownZodEvalProbe(v)), "CSP violations (ADR-0016 item 8)").toEqual(
        [],
      );
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
 * Runs axe (WCAG 2.1 A/AA, contrast included) and attaches the result. Report-only until
 * ADR-0016 step 4, when violations start failing the test.
 */
export async function reportAxe(page: Page, testInfo: TestInfo): Promise<void> {
  const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  await testInfo.attach("axe-violations.json", {
    body: JSON.stringify(result.violations, null, 2),
    contentType: "application/json",
  });
  if (result.violations.length > 0) {
    testInfo.annotations.push({
      type: "axe (report-only)",
      description: result.violations.map((v) => `${v.id}: ${v.nodes.length}`).join(", "),
    });
  }
}

import type { Page } from "@playwright/test";
import { expect, expectNoAxeViolations, test } from "../fixtures";

// The built demo site (ADR-0026), served with demo/_headers: every screen works with no
// network at all. The guards fixture already fails on a CSP violation or any /api request;
// these tests also fail on any request that leaves the demo's own origin. With the demo CSP
// intact, Chromium blocks such a fetch before it becomes a request, so the guards' CSP check
// is what fails; this recorder catches the case where the CSP is missing too.
const API_ORIGIN = "https://api.satis-manager.com";

/** Records every request the page makes, and aborts (and records) any to the real API. */
async function recordRequests(page: Page, baseURL: string): Promise<{ offOrigin: string[]; toApi: string[] }> {
  const offOrigin: string[] = [];
  const toApi: string[] = [];
  const origin = new URL(baseURL).origin;
  page.on("request", (request) => {
    const url = request.url();
    if (!url.startsWith("data:") && !url.startsWith("blob:") && new URL(url).origin !== origin) offOrigin.push(url);
  });
  await page.route(`${API_ORIGIN}/**`, (route) => {
    toApi.push(route.request().url());
    return route.abort();
  });
  return { offOrigin, toApi };
}

test("every screen works offline: enter, overview, power, factory, settings, log out", async ({ page, baseURL }, testInfo) => {
  const requests = await recordRequests(page, baseURL!);
  await page.goto("/?clock=fixed");

  await expect(page.getByText(/Demo data: nothing here is live/)).toBeVisible();
  const enter = page.getByRole("button", { name: "Enter demo" });
  await expect(enter).toBeVisible();
  await expect(page.getByLabel("Password")).toHaveCount(0);
  await expectNoAxeViolations(page, testInfo);

  await enter.click();
  const sections = page.getByRole("list", { name: "Sections" });
  await expect(sections.getByText(/Demo World · 3 \/ 4 players/)).toBeVisible();
  await expect(page.getByText(/Demo data: nothing here is live/)).toBeVisible();
  await expectNoAxeViolations(page, testInfo);

  const nav = page.getByRole("navigation", { name: "Main" });
  await nav.getByRole("link", { name: "Power" }).click();
  await expect(page).toHaveURL(/\/app\/power/);
  await expect(page.getByRole("article", { name: "Circuit 0", exact: true })).toBeVisible();
  await expect(page.locator(".power-chart canvas").first()).toBeVisible();
  await expectNoAxeViolations(page, testInfo);

  await nav.getByRole("link", { name: "Factory" }).click();
  await expect(page.getByText("9 machines · 1 backed up · 0 paused · 0 without a recipe")).toBeVisible();
  await expectNoAxeViolations(page, testInfo);

  // The map draws the demo world's own building positions (ADR-0026 item 6).
  await nav.getByRole("link", { name: "Map" }).click();
  await expect(page.getByRole("application", { name: /Factory map/ })).toBeVisible();
  await expect(page.getByText(/^9 buildings on the map:/)).toBeVisible();
  await expect(page.getByRole("table", { name: /Buildings in view/ })).toBeVisible();
  await expectNoAxeViolations(page, testInfo);

  await nav.getByRole("link", { name: "Settings" }).click();
  const toggle = page.getByRole("checkbox", { name: "Auto-pause when no players are connected" });
  await expect(toggle).toBeEnabled();
  await toggle.click();
  await expect(page.getByText("Change pending: the server will apply it.")).toBeVisible();
  await expectNoAxeViolations(page, testInfo);

  // Server management (ADR-0030): a simulated test, a LAN server refused, and nothing saved.
  await nav.getByRole("link", { name: "Servers" }).click();
  await page.getByRole("button", { name: "Test connection" }).click();
  await expect(page.getByText("Connection test passed.")).toBeVisible();
  await page.getByRole("button", { name: "Add a server" }).click();
  await page.getByLabel("Server id").fill("second");
  await page.getByLabel("Name").fill("Second world");
  await page.getByLabel("Host").fill("192.168.1.20");
  await page.getByLabel("Game API token").fill("demo-token");
  await page.getByRole("button", { name: "Add server" }).click();
  await expect(page.getByRole("alert")).toHaveText("Only servers on this machine can be added for now.");
  await page.getByLabel("Host").fill("127.0.0.1");
  await page.getByRole("button", { name: "Add server" }).click();
  await expect(page.getByRole("alert")).toContainText("The demo doesn't change servers.");
  await expectNoAxeViolations(page, testInfo);

  // The account menu (ADR-0025): axe-checked open, then Sign out. The demo offers no Google.
  await page.getByRole("button", { name: "Account" }).click();
  await expect(page.getByRole("button", { name: "Sign out everywhere" })).toBeVisible();
  await expectNoAxeViolations(page, testInfo);
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page.getByRole("button", { name: "Enter demo" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Sign in with Google" })).toHaveCount(0);

  expect(requests.toApi, `requests to ${API_ORIGIN}`).toEqual([]);
  expect(requests.offOrigin, "requests off the demo's origin").toEqual([]);
});

test("a deep link into the app lands on 'Enter demo'", async ({ page, baseURL }) => {
  const requests = await recordRequests(page, baseURL!);
  await page.goto("/app/nope");
  await expect(page.getByRole("button", { name: "Enter demo" })).toBeVisible();
  expect(requests.offOrigin, "requests off the demo's origin").toEqual([]);
});

test("links the main site's privacy and terms pages (the demo ships none of its own)", async ({ page }) => {
  await page.goto("/");
  const footer = page.getByRole("contentinfo");
  await expect(footer.getByRole("link", { name: "Privacy" })).toHaveAttribute("href", "https://satis-manager.com/privacy");
  await expect(footer.getByRole("link", { name: "Terms" })).toHaveAttribute("href", "https://satis-manager.com/terms");
});

test("serves the demo CSP: connect-src 'self' and no API origin", async ({ request }) => {
  const response = await request.get("/");
  expect(response.ok()).toBe(true);
  const csp = response.headers()["content-security-policy"] ?? "";
  expect(csp).toMatch(/connect-src 'self'(;|$)/);
  expect(csp).not.toContain("satis-manager.com");
});

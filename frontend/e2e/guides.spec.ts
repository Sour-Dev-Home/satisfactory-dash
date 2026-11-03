import type { Page } from "@playwright/test";
import { expect, expectNoAxeViolations, test } from "./fixtures";

// The guides and the changelog (site/plugin.ts, from frontend/content/): static HTML at /guides, /guides/<slug> and
// /changelog, served under the production CSP like the privacy page. The guards fixture fails a test on any CSP
// violation or /api call; these also fail on any script or any request off the site's origin.

function watchRequests(page: Page, origin: string) {
  const scripts: string[] = [];
  const offOrigin: string[] = [];
  page.on("request", (request) => {
    if (request.resourceType() === "script") scripts.push(request.url());
    const url = new URL(request.url());
    if (url.protocol.startsWith("http") && url.origin !== origin) offOrigin.push(request.url());
  });
  return { scripts, offOrigin };
}

async function expectStaticPage(page: Page, requests: ReturnType<typeof watchRequests>) {
  expect(await page.locator("script").count(), "script elements").toBe(0);
  expect(requests.scripts, "script requests").toEqual([]);
  expect(requests.offOrigin, "off-origin requests").toEqual([]);
  // Reflow at 390 px (WCAG 1.4.10): nothing scrolls the page sideways.
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, "sideways scroll").toBeLessThanOrEqual(0);
  const nav = page.getByRole("navigation", { name: "Site" });
  for (const name of ["Home", "Guides", "Changelog", "Demo", "Sign in"]) await expect(nav.getByRole("link", { name, exact: true })).toBeVisible();
  const footer = page.getByRole("contentinfo");
  for (const name of ["Source code (AGPL-3.0)", "Privacy", "Terms"]) await expect(footer.getByRole("link", { name })).toBeVisible();
}

test("the guides index lists every guide, script-free and accessible", async ({ page, baseURL }, testInfo) => {
  const requests = watchRequests(page, new URL(baseURL!).origin);
  const response = await page.goto("/guides");
  expect(response!.status()).toBe(200);
  expect(response!.headers()["content-security-policy"]).toContain("script-src 'self'");
  await expect(page).toHaveTitle("Guides · Satis Manager");
  await expect(page.getByRole("heading", { level: 1, name: "Guides" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Site" }).getByRole("link", { name: "Guides" })).toHaveAttribute("aria-current", "page");
  const first = page.getByRole("link", { name: "Getting started with Satis Manager" });
  await expect(first).toHaveAttribute("href", "/guides/getting-started");
  await expectStaticPage(page, requests);
  await expectNoAxeViolations(page, testInfo);

  await first.click();
  await expect(page).toHaveURL(/\/guides\/getting-started$/);
  await expect(page.getByRole("heading", { level: 1, name: "Getting started with Satis Manager" })).toBeVisible();
});

test("a guide renders its Markdown as a static page, accessible, with its canonical URL", async ({ page, baseURL }, testInfo) => {
  const requests = watchRequests(page, new URL(baseURL!).origin);
  const response = await page.goto("/guides/getting-started");
  expect(response!.status()).toBe(200);
  await expect(page.getByRole("heading", { level: 1, name: "Getting started with Satis Manager" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "Try the demo first" })).toBeVisible();
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", "https://satis-manager.com/guides/getting-started");
  await expect(page.locator('meta[name="description"]')).toHaveAttribute("content", /try the demo/);
  await expect(page.getByRole("link", { name: "All guides" })).toHaveAttribute("href", "/guides");
  await expectStaticPage(page, requests);
  await expectNoAxeViolations(page, testInfo);
});

test("the changelog is a static page too", async ({ page, baseURL }, testInfo) => {
  const requests = watchRequests(page, new URL(baseURL!).origin);
  const response = await page.goto("/changelog");
  expect(response!.status()).toBe(200);
  await expect(page.getByRole("heading", { level: 1, name: "Changelog" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Site" }).getByRole("link", { name: "Changelog" })).toHaveAttribute("aria-current", "page");
  await expectStaticPage(page, requests);
  await expectNoAxeViolations(page, testInfo);
});

test("the landing page links the guides and the changelog, as plain page loads", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("main").getByRole("link", { name: "Guides" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Guides" })).toBeVisible();
  await page.goto("/");
  await page.getByRole("contentinfo").getByRole("link", { name: "Changelog" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Changelog" })).toBeVisible();
});

test("sitemap.xml and robots.txt are served", async ({ request }) => {
  const sitemap = await request.get("/sitemap.xml");
  expect(sitemap.status()).toBe(200);
  expect(await sitemap.text()).toContain("<loc>https://satis-manager.com/guides/getting-started</loc>");
  const robots = await request.get("/robots.txt");
  expect(robots.status()).toBe(200);
  expect(await robots.text()).toContain("Sitemap: https://satis-manager.com/sitemap.xml");
});

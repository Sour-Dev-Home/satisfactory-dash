import { expect, expectNoAxeViolations, test } from "./fixtures";

// The public landing page at / (main site): static, so it must work with the backend off.
// The guards fixture fails the test on any /api request or CSP violation; this also fails on
// any request off the site's own origin (the demo is a link, not a fetch).

test("renders with no API or third-party request, and the demo button above the fold", async ({ page, baseURL }, testInfo) => {
  const offOrigin: string[] = [];
  const videoRequests: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.protocol.startsWith("http") && url.origin !== new URL(baseURL!).origin) offOrigin.push(request.url());
    if (url.pathname.endsWith(".mp4")) videoRequests.push(request.url());
  });

  await page.goto("/");
  await expect(page.getByRole("heading", { name: /A live dashboard for your Satisfactory dedicated server/ })).toBeVisible();
  const demo = page.getByRole("link", { name: "Try the live demo" });
  await expect(demo).toHaveAttribute("href", "https://demo.satis-manager.com");
  // Mobile first (the brief): the pitch and the demo button without scrolling, on a phone too.
  const box = await demo.boundingBox();
  expect(box!.y + box!.height).toBeLessThanOrEqual(page.viewportSize()!.height);
  await expect(page.locator("video")).toBeVisible();
  await page.waitForLoadState("networkidle");
  // Click to play: the page never downloads the video on its own (preload="none").
  expect(videoRequests, "video fetched before anyone pressed play").toEqual([]);

  await expectNoAxeViolations(page, testInfo);
  await expect(page).toHaveScreenshot("landing.png", { fullPage: true });
  expect(offOrigin, "requests off the site's origin").toEqual([]);
});

// The AdSense rejection (2026-11-03): / must carry its content in the served HTML, not only after JavaScript runs.
test("serves its text and links in the HTML itself, for crawlers without JavaScript", async ({ request }) => {
  const response = await request.get("/");
  expect(response.status()).toBe(200);
  const html = await response.text();
  for (const text of ["A live dashboard for your Satisfactory dedicated server", "Try the live demo", "What it shows", "Factory health", "Watch the walkthrough"]) {
    expect(html).toContain(text);
  }
  expect(html).toContain('href="/guides"');
  expect(html).toContain('href="/changelog"');
  // The app's paths keep the empty shell: no landing content flashes there.
  const app = await (await request.get("/app/power")).text();
  expect(app).toContain('<div id="root"></div>');
  expect(app).not.toContain("What it shows");
});

test.describe("with JavaScript off", () => {
  test.use({ javaScriptEnabled: false });

  test("the page, its demo and sign-in links and the guides are all there", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: /A live dashboard for your Satisfactory dedicated server/ })).toBeVisible();
    await expect(page.getByRole("link", { name: "Try the live demo" })).toHaveAttribute("href", "https://demo.satis-manager.com");
    await expect(page.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/app");
    const footer = page.getByRole("contentinfo");
    await expect(footer.getByRole("link", { name: "Guides" })).toHaveAttribute("href", "/guides");
    await expect(footer.getByRole("link", { name: "Changelog" })).toHaveAttribute("href", "/changelog");
  });
});

test("hydrates the prerendered page without a mismatch", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  // Hydrated: React has attached to the served markup (its internal keys are on the node), not just painted it.
  await expect.poll(() => page.evaluate(() => Object.keys(document.querySelector("#root > div")!).some((key) => key.startsWith("__react")))).toBe(true);
  expect(errors, "console errors (a hydration mismatch logs one)").toEqual([]);
});

test("Sign in opens the app's sign-in form", async ({ page, mockApi }) => {
  await mockApi("login");
  await page.goto("/");
  await page.getByRole("link", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await expect(page).toHaveURL(/\/app$/);
});

test("serves the walkthrough video as MP4, seekable, under the static-asset size limit", async ({ request }) => {
  // A Range request is what a player sends to seek; 206 means the server honours it.
  const response = await request.get("/demo/walkthrough.mp4", { headers: { Range: "bytes=0-1023" } });
  expect(response.status()).toBe(206);
  expect(response.headers()["content-type"]).toContain("video/mp4");
  const total = Number(response.headers()["content-range"]?.split("/")[1]);
  // Workers static assets cap each file at 25 MiB on every plan
  // (https://developers.cloudflare.com/workers/platform/limits/#static-assets); stay well under it.
  expect(total).toBeGreaterThan(0);
  expect(total).toBeLessThan(20 * 1024 * 1024);
});

// The transcript must be rendered for the video's aria-describedby to count: Chrome drops a
// description whose target isn't rendered (the fresh-eyes pass on #129 found it hidden in a
// closed <details>). axe can't see this (the id reference itself is valid), and neither can
// jsdom, so this reads Chrome's own accessibility tree.
test("the video's text alternative (WCAG 1.2.1) is its accessible description", async ({ page }) => {
  await page.goto("/");
  await page.waitForSelector("video");
  const client = await page.context().newCDPSession(page);
  await client.send("Accessibility.enable");
  const { nodes } = await client.send("Accessibility.getFullAXTree");
  const video = nodes.find((node) => node.role?.value === "Video");
  expect(String(video?.description?.value ?? ""), "the video's accessible description").toContain("Back to the Overview");
});

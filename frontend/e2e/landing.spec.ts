import { expect, expectNoAxeViolations, test } from "./fixtures";

// The public landing page at / (main site): static, so it must work with the backend off.
// The guards fixture fails the test on any /api request or CSP violation; this also fails on
// any request off the site's own origin (the demo is a link, not a fetch).

test("renders with no API or third-party request, and the demo button above the fold", async ({ page, baseURL }, testInfo) => {
  const offOrigin: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.protocol.startsWith("http") && url.origin !== new URL(baseURL!).origin) offOrigin.push(request.url());
  });

  await page.goto("/");
  await expect(page.getByRole("heading", { name: /A live dashboard for your Satisfactory dedicated server/ })).toBeVisible();
  const demo = page.getByRole("link", { name: "Try the live demo" });
  await expect(demo).toHaveAttribute("href", "https://demo.satis-manager.com");
  // Mobile first (the brief): the pitch and the demo button without scrolling, on a phone too.
  const box = await demo.boundingBox();
  expect(box!.y + box!.height).toBeLessThanOrEqual(page.viewportSize()!.height);
  await expect(page.getByRole("img", { name: /The Overview in the demo/ })).toBeVisible();
  await page.waitForLoadState("networkidle");

  await expectNoAxeViolations(page, testInfo);
  await expect(page).toHaveScreenshot("landing.png", { fullPage: true });
  expect(offOrigin, "requests off the site's origin").toEqual([]);
});

test("Sign in opens the app's sign-in form", async ({ page, mockApi }) => {
  await mockApi("login");
  await page.goto("/");
  await page.getByRole("link", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await expect(page).toHaveURL(/\/app$/);
});

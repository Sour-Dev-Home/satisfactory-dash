import { expect, test } from "./fixtures";

// The fonts are self-hosted (ADR-0041; the CSP is font-src 'self'): every font request stays on the
// site's origin, under /fonts/, and both faces really load and get used. The guards fixture already
// fails on a CSP violation; this also fails on a font fetched from anywhere else.

test("loads Barlow and Barlow Condensed from the site's own origin only", async ({ page, baseURL, mockApi }) => {
  const fontRequests: string[] = [];
  page.on("request", (request) => {
    if (request.resourceType() === "font" || /\.(woff2?|ttf|otf)(\?|$)/.test(request.url())) fontRequests.push(request.url());
  });

  await mockApi("default");
  await page.goto("/app");
  await expect(page.getByRole("heading", { name: "Health" })).toBeVisible();
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await page.waitForLoadState("networkidle");

  const origin = new URL(baseURL!).origin;
  expect(fontRequests.length, "no font was requested").toBeGreaterThan(0);
  expect(
    fontRequests.filter((url) => new URL(url).origin !== origin || !new URL(url).pathname.startsWith("/fonts/")),
    "font requests off the site's /fonts/",
  ).toEqual([]);

  const loaded = await page.evaluate(() =>
    [...document.fonts].filter((face) => face.status === "loaded").map((face) => `${face.family.replace(/"/g, "")} ${face.weight}`),
  );
  expect(loaded).toContain("Barlow 400");
  expect(loaded.some((face) => face.startsWith("Barlow Condensed "))).toBe(true);

  // Headings take the display face, body text the text face.
  const heading = page.getByRole("heading", { name: "Health" });
  await expect(heading).toHaveCSS("font-family", /^"Barlow Condensed"/);
  await expect(heading).toHaveCSS("text-transform", "uppercase");
  await expect(page.locator("body")).toHaveCSS("font-family", /^Barlow,/);
});

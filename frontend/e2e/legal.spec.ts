import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, expectNoAxeViolations, test } from "./fixtures";

// The privacy and terms pages (gate B: Google's consent screen needs the privacy URL): static
// HTML served by Workers static assets at /privacy and /terms, under the production CSP. The
// guards fixture fails a test on any CSP violation or /api call.

const DIST = join(import.meta.dirname, "..", "dist");
/** The operator's name, read from LICENSE at run time: it's never written into a test. */
const OPERATOR = /^Copyright \(C\) \d{4} (.+)$/m.exec(readFileSync(join(import.meta.dirname, "..", "..", "LICENSE"), "utf8"))![1].trim();

for (const [path, title] of [
  ["/privacy", "Privacy Policy"],
  ["/terms", "Terms of Use"],
] as const) {
  test(`${path} is a static page: no script, same-origin only, accessible`, async ({ page, baseURL }, testInfo) => {
    const scripts: string[] = [];
    const offOrigin: string[] = [];
    page.on("request", (request) => {
      if (request.resourceType() === "script") scripts.push(request.url());
      const url = new URL(request.url());
      if (url.protocol.startsWith("http") && url.origin !== new URL(baseURL!).origin) offOrigin.push(request.url());
    });
    const response = await page.goto(path);
    expect(response!.status()).toBe(200);
    expect(response!.headers()["content-security-policy"]).toContain("script-src 'self'");
    await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
    expect(await page.locator("script").count(), "script elements").toBe(0);
    expect(scripts, "script requests").toEqual([]);
    expect(offOrigin, "off-origin requests").toEqual([]);
    await expect(page.getByText("privacy@satis-manager.com").first()).toBeVisible();
    await expectNoAxeViolations(page, testInfo);
  });
}

test("the landing page and the sign-in screen link both pages", async ({ page, mockApi }) => {
  await page.goto("/");
  const footer = page.getByRole("contentinfo");
  await expect(footer.getByRole("link", { name: "Privacy" })).toHaveAttribute("href", "/privacy");
  await expect(footer.getByRole("link", { name: "Terms" })).toHaveAttribute("href", "/terms");

  await mockApi("login");
  await page.goto("/app");
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await expect(page.getByRole("contentinfo").getByRole("link", { name: "Privacy" })).toHaveAttribute("href", "/privacy");
  await expect(page.getByRole("contentinfo").getByRole("link", { name: "Terms" })).toHaveAttribute("href", "/terms");
});

// legal.css can't use the app's tokens (no build step for these static pages), so it copies
// their values: this keeps the copy honest when a token changes.
test("legal.css uses only the app's design-token colours", () => {
  const read = (path: string) => readFileSync(join(import.meta.dirname, "..", path), "utf8").toLowerCase();
  const tokens = new Set([...read("src/index.css").matchAll(/--color-[\w-]+:\s*(#[0-9a-f]{6})\b/g)].map((m) => m[1]));
  const used = [...new Set([...read("public/legal.css").matchAll(/#[0-9a-f]{6}\b/g)].map((m) => m[0]))];
  expect(used.length).toBeGreaterThan(0);
  expect(used.filter((hex) => !tokens.has(hex)), "colours in legal.css that aren't tokens").toEqual([]);
});

test("the terms never name the operator; nothing built but the privacy page does", () => {
  expect(OPERATOR.length).toBeGreaterThan(3);
  const files = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(join(dir, e.name)) : [join(dir, e.name)]));
  const naming = files(DIST)
    .filter((f) => /\.(html|js|css|json|txt|svg)$/.test(f))
    .filter((f) => readFileSync(f, "utf8").includes(OPERATOR))
    .map((f) => f.slice(DIST.length + 1).replaceAll("\\", "/"));
  expect(naming.every((f) => f === "privacy.html"), `files naming the operator: ${naming.join(", ")}`).toBe(true);
  expect(readFileSync(join(DIST, "terms.html"), "utf8")).toMatch(/the\s+operator named in our/);
  expect(readFileSync(join(DIST, "privacy.html"), "utf8")).toContain("privacy@satis-manager.com");
});

// test-hunter finding: the previous test only checks that IF the real operator name (from
// LICENSE) appears anywhere in dist, it's confined to privacy.html -- it never checks that
// privacy.html actually contains it. So it stays green even if the "[OPERATOR NAME]" placeholder
// ships unreplaced (e.g. if #133's narrowing of the PII-scan exclusion lands before someone fills
// in the real name). This test closes that gap and is expected to fail until the placeholder is
// replaced with the LICENSE name.
test("privacy.html names the actual operator, not the placeholder", () => {
  const privacy = readFileSync(join(DIST, "privacy.html"), "utf8");
  expect(privacy).not.toContain("[OPERATOR NAME]");
  expect(privacy).toContain(OPERATOR);
});

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "./fixtures";

// The production build the other specs run against: check it ships none of the mock tooling
// and is served with the production security headers.

const DIST = join(import.meta.dirname, "..", "dist");

function allFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? allFiles(join(dir, entry.name)) : [join(dir, entry.name)],
  );
}

// Runs in the desktop project only (see playwright.config.ts).
test.describe("production build", () => {
  test("contains no mock API code, MSW worker or fixture data", () => {
    const files = allFiles(DIST);
    expect(files.some((f) => f.endsWith("mockServiceWorker.js"))).toBe(false);
    const text = files
      .filter((f) => /\.(js|html|css)$/.test(f))
      .map((f) => readFileSync(f, "utf8"))
      .join("\n");
    // Markers of msw's browser runtime, the mock-mode module and a fixture-only value.
    for (const marker of ["setupWorker", "[mock api]", "ExampleSession", "example-password"]) {
      expect(text, `production bundle contains ${marker}`).not.toContain(marker);
    }
  });

  test("is served with the production security headers", async ({ request }) => {
    const response = await request.get("/");
    const csp = response.headers()["content-security-policy"] ?? "";
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("style-src 'self'");
    expect(response.headers()["x-frame-options"]).toBe("DENY");
  });
});

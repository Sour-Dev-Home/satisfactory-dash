import { test } from "./fixtures";

// The auto `guards` fixture must fail a test on a real CSP violation and on an unmocked /api
// request. test.fail() inverts the result: these pass only if the guard catches the problem.

test.describe("guards", () => {
  test.fail("an injected inline <style> (what some UI libraries do) fails the test", async ({ page, mockApi }) => {
    await mockApi("login");
    await page.goto("/app");
    await page.getByRole("heading", { name: "Sign in" }).waitFor();
    await page.evaluate(() => {
      const style = document.createElement("style");
      style.textContent = "body { outline: 1px solid red; }";
      document.head.append(style);
    });
    // Give the browser a moment to report the violation event.
    await page.waitForTimeout(100);
  });

  // The zod eval-probe exception is gone, so a caught `new Function` (exactly what zod's probe
  // did) must fail the test again. Without this case nothing proves the guard sees evals at all.
  test.fail("a caught `new Function` (zod's old eval probe) fails the test", async ({ page, mockApi }) => {
    await mockApi("login");
    await page.goto("/app");
    await page.getByRole("heading", { name: "Sign in" }).waitFor();
    // page.evaluate runs outside the page's CSP (a `new Function` there succeeds), so the probe
    // has to be a real same-origin script, which script-src 'self' loads and then governs.
    await page.route("**/eval-probe.js", (route) =>
      route.fulfill({
        contentType: "text/javascript",
        body: 'try { const F = Function; new F(""); } catch { /* swallowed, as zod does */ }',
      }),
    );
    await page.addScriptTag({ url: "/eval-probe.js" });
    await page.waitForTimeout(100);
  });

  test.fail("an /api request with no mock fails the test", async ({ page, mockApi }) => {
    await mockApi("login");
    await page.goto("/app");
    await page.getByRole("heading", { name: "Sign in" }).waitFor();
    await page.evaluate(() => fetch("/api/not-a-real-route").catch(() => undefined));
  });

  test.fail("an /api request in a test that never calls mockApi fails the test", async ({ page }) => {
    // The app's own session check is the unmocked request.
    const sessionCheck = page.waitForRequest((request) => new URL(request.url()).pathname === "/api/auth/session");
    await page.goto("/app");
    await sessionCheck;
  });
});

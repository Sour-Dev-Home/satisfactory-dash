import { test } from "./fixtures";

// The auto `guards` fixture must fail a test on a real CSP violation and on an unmocked /api
// request. test.fail() inverts the result: these pass only if the guard catches the problem.

test.describe("guards", () => {
  test.fail("an injected inline <style> (what some UI libraries do) fails the test", async ({ page, mockApi }) => {
    await mockApi("login");
    await page.goto("/");
    await page.getByRole("heading", { name: "Sign in" }).waitFor();
    await page.evaluate(() => {
      const style = document.createElement("style");
      style.textContent = "body { outline: 1px solid red; }";
      document.head.append(style);
    });
    // Give the browser a moment to report the violation event.
    await page.waitForTimeout(100);
  });

  test.fail("an /api request with no mock fails the test", async ({ page, mockApi }) => {
    await mockApi("login");
    await page.goto("/");
    await page.getByRole("heading", { name: "Sign in" }).waitFor();
    await page.evaluate(() => fetch("/api/not-a-real-route").catch(() => undefined));
  });

  test.fail("an /api request in a test that never calls mockApi fails the test", async ({ page }) => {
    // The app's own session check is the unmocked request.
    const sessionCheck = page.waitForRequest((request) => new URL(request.url()).pathname === "/api/auth/session");
    await page.goto("/");
    await sessionCheck;
  });
});

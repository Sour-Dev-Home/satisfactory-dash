import type { Page, Route } from "@playwright/test";
import { AD_UNITS } from "../src/ads/config";
import { handle } from "../worker/handle";
import { FakeRewriter } from "../worker/testRewriter";
import { expect, expectNoAxeViolations, test } from "./fixtures";

// ADR-0021 amendment 3, build step 4: the site with the ads switch ON, without reaching Google. Every page load goes
// through the Worker's own `handle` (ADS_ENABLED "true"), so the page gets the ads-on CSP header, the nonces, the
// AdSense loader and the marker exactly as the Worker writes them (worker/testRewriter.ts stands in for Cloudflare's
// HTMLRewriter). Google's hosts answer from a local stub that does what the real code does to the page: loads another
// script (strict-dynamic), uses eval, writes inline styles, opens an https iframe, sends an image beacon and a fetch.
// The guards fixture still fails the test on any CSP violation, and axe still runs. Every other spec runs with the
// switch off, as vite preview serves the built files with public/_headers.

const GOOGLE_HOSTS = ["pagead2.googlesyndication.com", "fundingchoicesmessages.google.com", "googleads.g.doubleclick.net"];

declare global {
  interface Window {
    __adsStub?: { pushes: number; revocations: number; dynamicScript: boolean; evalWorks: boolean; styled: boolean };
  }
}

/** What the stand-in for adsbygoogle.js does: enough of AdSense's and the CMP's API, and their effects on the page. */
const LOADER_STUB = `(() => {
  const stub = (window.__adsStub = { pushes: 0, revocations: 0, dynamicScript: false, evalWorks: false, styled: false });
  const fill = () => {
    for (const ins of document.querySelectorAll("ins.adsbygoogle:not([data-ad-status])")) {
      ins.setAttribute("data-ad-status", "filled");
      const frame = document.createElement("iframe");
      frame.src = "https://googleads.g.doubleclick.net/stub-creative";
      frame.title = "Advertisement";
      frame.setAttribute("style", "border:0;width:100%;height:100%");
      ins.append(frame);
    }
  };
  const queued = Array.isArray(window.adsbygoogle) ? window.adsbygoogle : [];
  window.adsbygoogle = { push: () => { stub.pushes++; fill(); } };
  queued.forEach(() => window.adsbygoogle.push({}));
  const fc = (window.googlefc = window.googlefc || {});
  fc.showRevocationMessage = () => { stub.revocations++; };
  const waiting = Array.isArray(fc.callbackQueue) ? fc.callbackQueue : [];
  fc.callbackQueue = { push: (fn) => fn() };
  waiting.forEach((fn) => fn());
  stub.evalWorks = eval("1 + 1") === 2;
  const consent = document.createElement("div");
  consent.setAttribute("style", "position:absolute;width:0;height:0;overflow:hidden");
  document.body.append(consent);
  stub.styled = getComputedStyle(consent).position === "absolute";
  // The consent message's own frame, as Google's CMP opens one whatever the slots.
  const message = document.createElement("iframe");
  message.src = "https://fundingchoicesmessages.google.com/stub-message";
  message.title = "Privacy message";
  message.setAttribute("style", "border:0;width:0;height:0");
  consent.append(message);
  const cmp = document.createElement("script");
  cmp.src = "https://fundingchoicesmessages.google.com/stub-cmp.js";
  document.head.append(cmp);
  new Image().src = "https://pagead2.googlesyndication.com/stub-beacon.gif";
  fetch("https://pagead2.googlesyndication.com/stub-fetch", { mode: "no-cors" }).catch(() => {});
})();`;

const PIXEL = Buffer.from("R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==", "base64");

async function serveThroughWorker(route: Route): Promise<void> {
  const request = route.request();
  const upstream = await route.fetch();
  const headers = { ...upstream.headers() };
  // route.fetch() hands over the decoded body; its length and encoding no longer describe it.
  delete headers["content-encoding"];
  delete headers["content-length"];
  const asset = new Response(request.method() === "HEAD" ? null : await upstream.text(), { status: upstream.status(), headers });
  const response = await handle(new Request(request.url(), { method: request.method() }), { ASSETS: { fetch: async () => asset }, ADS_ENABLED: "true" }, FakeRewriter);
  await route.fulfill({
    status: response.status,
    headers: Object.fromEntries(response.headers),
    body: Buffer.from(await response.arrayBuffer()),
  });
}

/** Ads on for this page: documents through the Worker, Google's hosts from the stub, anything else off-origin refused. */
async function adsOn(page: Page, baseURL: string): Promise<{ offOrigin: string[]; csp: string[] }> {
  const offOrigin: string[] = [];
  const csp: string[] = [];
  const origin = new URL(baseURL).origin;
  await page.route(
    (url) => url.origin !== origin,
    async (route) => {
      const url = new URL(route.request().url());
      if (!GOOGLE_HOSTS.includes(url.hostname)) {
        offOrigin.push(url.href);
        return route.abort();
      }
      if (url.pathname === "/pagead/js/adsbygoogle.js") return route.fulfill({ contentType: "text/javascript", body: LOADER_STUB });
      if (url.pathname.endsWith(".js")) return route.fulfill({ contentType: "text/javascript", body: "window.__adsStub.dynamicScript = true;" });
      if (url.pathname.endsWith(".gif")) return route.fulfill({ contentType: "image/gif", body: PIXEL });
      if (url.pathname === "/stub-fetch") return route.fulfill({ contentType: "text/plain", body: "" });
      // A frame of Google's own (a creative, the consent message): its content is not ours to audit, so it is empty.
      return route.fulfill({ contentType: "text/html", body: '<!doctype html><html lang="en"><title>Advertisement</title></html>' });
    },
  );
  await page.route(
    (url) => url.origin === origin && !url.pathname.startsWith("/api/"),
    (route) => (route.request().resourceType() === "document" ? serveThroughWorker(route) : route.fallback()),
  );
  page.on("response", (response) => {
    if (response.request().resourceType() === "document" && response.url().startsWith(origin)) {
      csp.push(response.headers()["content-security-policy"] ?? "");
    }
  });
  return { offOrigin, csp };
}

const placeholdersOnly = Object.values(AD_UNITS).every((unit) => unit === null);

test("the app with ads on: the loader runs under the ads-on CSP, the consent link works, no CSP violation, axe passes", async ({ page, mockApi, baseURL }, testInfo) => {
  const { offOrigin, csp } = await adsOn(page, baseURL!);
  await mockApi("default");
  await page.goto("/app");
  await expect(page.getByRole("region", { name: "Server status" })).toBeVisible();

  expect(csp[0]).toMatch(/script-src 'nonce-[A-Za-z0-9+/]{22}==' 'unsafe-inline' 'unsafe-eval' 'strict-dynamic' https: http:/);
  await expect(page.locator('meta[name="satis-ads"][content="on"]')).toHaveCount(1);
  await expect(page.locator('script[src*="googlesyndication.com/pagead/js/adsbygoogle.js"]')).toHaveCount(1);
  // The stub ran, and so did what the real ad code does under this policy.
  await expect.poll(() => page.evaluate(() => window.__adsStub?.dynamicScript)).toBe(true);
  expect(await page.evaluate(() => window.__adsStub)).toMatchObject({ evalWorks: true, styled: true });

  // "Privacy and cookie settings" opens Google's message again (E7, E10).
  await page.getByRole("button", { name: "Privacy and cookie settings" }).click();
  await expect.poll(() => page.evaluate(() => window.__adsStub?.revocations)).toBe(1);

  // The shipped unit ids are placeholders, so no slot renders and AdSense is asked for nothing.
  const slots = page.getByRole("complementary", { name: "Advertisements" });
  if (placeholdersOnly) {
    await expect(slots).toHaveCount(0);
    expect(await page.evaluate(() => window.__adsStub?.pushes)).toBe(0);
  } else {
    // Once the owner fills in the units: one slot on the Overview, its reserved size kept when the ad arrives.
    await expect(slots).toHaveCount(1);
    await expect(page.locator('ins.adsbygoogle[data-ad-status="filled"]')).toHaveCount(1);
  }

  // The slot's reserved size in the built CSS (the --spacing-ad-* tokens and breakpoints), measured on a copy of its
  // <ins> classes: 728x90 at desktop width, 320x100 on a phone (U-E5's exact sizes).
  const size = await page.evaluate(() => {
    const probe = document.createElement("div");
    probe.className = "block h-ad-phone-h w-ad-phone-w sm:h-ad-mid-h sm:w-ad-mid-w lg:h-ad-wide-h lg:w-ad-wide-w";
    document.body.append(probe);
    const { width, height } = probe.getBoundingClientRect();
    probe.remove();
    return { width, height };
  });
  expect(size).toEqual(testInfo.project.name === "mobile" ? { width: 320, height: 100 } : { width: 728, height: 90 });

  await expectNoAxeViolations(page, testInfo);
  expect(offOrigin, "requests off the site's origin that are not Google's (stubbed) hosts").toEqual([]);
});

test("the landing page and Settings with ads on: the consent link, and no slot", async ({ page, mockApi, baseURL }, testInfo) => {
  const { offOrigin } = await adsOn(page, baseURL!);
  await page.goto("/");
  await expect(page.getByRole("link", { name: "Try the live demo" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Privacy and cookie settings" })).toBeVisible();
  await expect(page.locator("[data-ad-placement]")).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.__adsStub?.dynamicScript)).toBe(true);
  await expectNoAxeViolations(page, testInfo);

  await mockApi("default");
  await page.goto("/app/settings");
  await expect(page.getByRole("region", { name: "Server settings" })).toBeVisible();
  await expect(page.locator("[data-ad-placement]")).toHaveCount(0);
  expect(offOrigin).toEqual([]);
});

test("the privacy page with ads on: the loader runs there too, under the same policy, with no violation", async ({ page, baseURL }) => {
  const { offOrigin, csp } = await adsOn(page, baseURL!);
  await page.goto("/privacy.html");
  await expect(page.locator("h1")).toBeVisible();
  expect(csp.at(-1)).toContain("'strict-dynamic'");
  await expect.poll(() => page.evaluate(() => window.__adsStub?.dynamicScript)).toBe(true);
  expect(offOrigin).toEqual([]);
});

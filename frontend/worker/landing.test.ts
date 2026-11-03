// `/` is the prerendered landing page (dist/landing.html, site/plugin.ts), served through the Worker like every HTML
// page; index.html stays the SPA's empty shell for every other path (ADR-0021, 2026-11-03 build note).
import { describe, expect, it } from "vitest";
import { LANDING_ASSET_PATH } from "../site/paths";
import { assetRequest, handle, type Env } from "./handle";
import { OFF_POLICY, SECURITY_HEADERS } from "./securityHeaders";
import { FakeRewriter } from "./testRewriter";

const get = (path: string, init?: RequestInit) => new Request(`https://satis-manager.com${path}`, init);
const LANDING = `<!doctype html><html><head></head><body><div id="root"><h2>Landing</h2></div><script type="module" src="/assets/i.js"></script></body></html>`;

/** An assets binding that answers by path, recording each request: /landing is the page, anything else the shell. */
function assets() {
  const calls: Request[] = [];
  const binding: Env["ASSETS"] = {
    async fetch(request: Request) {
      calls.push(request);
      const body = new URL(request.url).pathname === LANDING_ASSET_PATH ? LANDING : "<div id=\"root\"></div>";
      return new Response(body, { headers: { "Content-Type": "text/html; charset=utf-8", ETag: '"e"' } });
    },
  };
  return { calls, binding };
}

describe("assetRequest", () => {
  it("asks the assets for the landing page's file for exactly /, keeping the query", () => {
    expect(new URL(assetRequest(get("/")).url).pathname).toBe("/landing");
    expect(new URL(assetRequest(get("/?ref=x")).url).search).toBe("?ref=x");
  });

  it("keeps the method and headers, conditional ones included", () => {
    const request = assetRequest(get("/", { method: "HEAD", headers: { "If-None-Match": '"e"' } }));
    expect(request.method).toBe("HEAD");
    expect(request.headers.get("If-None-Match")).toBe('"e"');
  });

  it.each(["/app", "/app/", "/guides", "/guides/getting-started", "/changelog", "/privacy", "/index.html", "//"])(
    "leaves %s as it is",
    (path) => {
      const request = get(path);
      expect(assetRequest(request)).toBe(request);
    },
  );
});

describe("the Worker at /", () => {
  it("serves the landing page with a nonce and today's headers", async () => {
    const { calls, binding } = assets();
    const response = await handle(get("/"), { ASSETS: binding }, FakeRewriter);
    expect(new URL(calls[0].url).pathname).toBe("/landing");
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain("<h2>Landing</h2>");
    expect(html).toMatch(/<script[^>]* nonce="/);
    expect(response.headers.get("Content-Security-Policy")).toBe(OFF_POLICY);
    expect(response.headers.get("Cache-Control")).toBe("private, no-cache");
  });

  it("still serves the empty shell for the app", async () => {
    const { calls, binding } = assets();
    const html = await (await handle(get("/app/power"), { ASSETS: binding }, FakeRewriter)).text();
    expect(new URL(calls[0].url).pathname).toBe("/app/power");
    expect(html).not.toContain("Landing");
  });

  it("redirects the landing file's own path to /, with the query and the security headers", async () => {
    const { calls, binding } = assets();
    const response = await handle(get("/landing?x=1"), { ASSETS: binding }, FakeRewriter);
    expect(calls).toEqual([]);
    expect(response.status).toBe(301);
    expect(response.headers.get("Location")).toBe("/?x=1");
    for (const [name, value] of SECURITY_HEADERS) expect(response.headers.get(name), name).toBe(value);
  });

  it("does not redirect paths that only start like it", async () => {
    const { binding } = assets();
    for (const path of ["/landing/", "/landings", "/app/landing"]) {
      expect((await handle(get(path), { ASSETS: binding }, FakeRewriter)).status, path).toBe(200);
    }
  });
});

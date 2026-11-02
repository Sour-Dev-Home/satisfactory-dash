import { describe, expect, it } from "vitest";
import { handle, loadsScript, type Env } from "./index";
import type { HTMLRewriterInstance } from "./htmlRewriter";
import { OFF_POLICY, onPolicy, withDirectives } from "./securityHeaders";

// Records what the Worker asked the rewriter to do, without parsing HTML (the real one is unavailable in Node).
class SpyRewriter implements HTMLRewriterInstance {
  static selectors: string[] = [];
  on(selector: string) {
    SpyRewriter.selectors.push(selector);
    return this;
  }
  transform(response: Response) {
    return response;
  }
}

const get = (init?: RequestInit) => new Request("https://satis-manager.com/app", init);
const withType = (type: string, status = 200): Env => ({
  ASSETS: { fetch: async () => new Response("<script></script>", { status, headers: { "Content-Type": type } }) },
});

describe("edge cases", () => {
  it.each(["text/htmlx", "text/html-foo", "application/xhtml+xml", "text/ html"])("does not treat %s as HTML", async (type) => {
    SpyRewriter.selectors = [];
    const response = await handle(get(), withType(type), SpyRewriter);
    // Not rewritten and not given the HTML-only cache header; it still gets today's headers, as every response does.
    expect(SpyRewriter.selectors).toEqual([]);
    expect(response.headers.get("Cache-Control")).toBeNull();
    expect(response.headers.get("Content-Security-Policy")).toBe(OFF_POLICY);
  });

  it("keeps a non-200 HTML status and still protects it", async () => {
    const response = await handle(get(), withType("text/html", 404), SpyRewriter);
    expect(response.status).toBe(404);
    expect(response.headers.get("Content-Security-Policy")).toBe(OFF_POLICY);
  });

  it("registers handlers for script and link only", async () => {
    SpyRewriter.selectors = [];
    await handle(get(), withType("text/html"), SpyRewriter);
    expect([...SpyRewriter.selectors].sort()).toEqual(["link", "script"]);
  });

  it("keeps Set-Cookie and other asset headers it does not own", async () => {
    const env: Env = {
      ASSETS: { fetch: async () => new Response("x", { headers: { "Content-Type": "text/html", "Set-Cookie": "a=1", "X-Custom": "y" } }) },
    };
    const response = await handle(get(), env, SpyRewriter);
    expect(response.headers.get("Set-Cookie")).toBe("a=1");
    expect(response.headers.get("X-Custom")).toBe("y");
  });

  it("turns a conditional HEAD for an HTML page into a 200 with the policy", async () => {
    const env: Env = {
      ASSETS: {
        fetch: async (r) => (r.headers.get("If-None-Match") ? new Response(null, { status: 304 }) : new Response(null, { headers: { "Content-Type": "text/html" } })),
      },
    };
    const response = await handle(get({ method: "HEAD", headers: { "If-None-Match": '"a"' } }), env, SpyRewriter);
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Security-Policy")).toBe(OFF_POLICY);
  });

  it("loadsScript tolerates odd rel spacing and case, and rejects non-script preloads", () => {
    const el = (tagName: string, attrs: Record<string, string>) => {
      const element = { tagName, getAttribute: (n: string) => attrs[n] ?? null, setAttribute: () => element };
      return element;
    };
    expect(loadsScript(el("LINK", { rel: "  ModulePreload  " }))).toBe(true);
    expect(loadsScript(el("link", { rel: "preload", as: "SCRIPT" }))).toBe(true);
    expect(loadsScript(el("link", { rel: "preload", as: "style" }))).toBe(false);
    expect(loadsScript(el("link", { rel: "stylesheet" }))).toBe(false);
    expect(loadsScript(el("link", {}))).toBe(false);
  });

  it("onPolicy has each overridden directive exactly once and keeps the others", () => {
    const policy = onPolicy("N+/=");
    for (const name of ["script-src", "object-src", "base-uri"]) {
      expect(policy.split(";").filter((p) => p.trim().startsWith(`${name} `))).toHaveLength(1);
    }
    expect(policy).toContain("script-src 'nonce-N+/=' 'unsafe-inline' 'unsafe-eval' 'strict-dynamic' https: http:");
    expect(policy).toContain("frame-ancestors 'none'");
    expect(policy).not.toContain("script-src 'self'");
  });

  it("withDirectives appends a missing directive and tolerates stray semicolons", () => {
    expect(withDirectives("default-src 'self';; ", [["base-uri", "'none'"]])).toBe("default-src 'self'; base-uri 'none'");
  });
});

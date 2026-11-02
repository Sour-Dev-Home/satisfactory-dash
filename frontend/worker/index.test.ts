import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import worker from "./index";
import { adsEnabled, handle, makeNonce, NONCE_BYTES, type Env } from "./handle";
import type { HTMLRewriterInstance, RewriterElement, RewriterElementHandler } from "./htmlRewriter";
import { OFF_POLICY, onPolicy, SECURITY_HEADERS } from "./securityHeaders";

/**
 * A stand-in for Cloudflare's HTMLRewriter (not available in Node): finds start tags by name and lets the handlers
 * read and set attributes, as the real one does for a tag-name selector (E6). Enough for the double-quoted attributes
 * Vite and the static pages write; which elements get a nonce is decided by the Worker, not by this.
 */
class FakeRewriter implements HTMLRewriterInstance {
  private handlers: [string, RewriterElementHandler][] = [];

  on(selector: string, handler: RewriterElementHandler): HTMLRewriterInstance {
    this.handlers.push([selector, handler]);
    return this;
  }

  transform(response: Response): Response {
    const handlers = this.handlers;
    const body = response.text().then((html) =>
      html.replace(/<([a-zA-Z][\w-]*)((?:\s+[^\s=>/]+(?:="[^"]*")?)*)\s*(\/?)>/g, (tag, name: string, rawAttrs: string, selfClose: string) => {
        const matching = handlers.filter(([selector]) => selector === name.toLowerCase());
        if (matching.length === 0) return tag;
        const attrs: [string, string | null][] = [...rawAttrs.matchAll(/\s+([^\s=>/]+)(?:="([^"]*)")?/g)].map((m) => [m[1], m[2] ?? null]);
        const element: RewriterElement = {
          tagName: name.toLowerCase(),
          getAttribute: (attr) => {
            const found = attrs.find(([key]) => key.toLowerCase() === attr);
            return found ? (found[1] ?? "") : null;
          },
          setAttribute(attr, value) {
            const found = attrs.find(([key]) => key.toLowerCase() === attr);
            if (found) found[1] = value;
            else attrs.push([attr, value]);
            return element;
          },
        };
        for (const [, handler] of matching) handler.element(element);
        const rebuilt = attrs.map(([key, value]) => (value === null ? ` ${key}` : ` ${key}="${value}"`)).join("");
        return `<${name}${rebuilt}${selfClose ? " /" : ""}>`;
      }),
    );
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        controller.enqueue(new TextEncoder().encode(await body));
        controller.close();
      },
    });
    return new Response(stream, response);
  }
}

/** What Vite writes into dist/index.html: an entry module script and modulepreload links. */
const VITE_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
    <link rel="manifest" href="/site.webmanifest" />
    <script type="module" crossorigin src="/assets/index-AbC123.js"></script>
    <link rel="modulepreload" crossorigin href="/assets/zod-XyZ789.js">
    <link rel="preload" as="script" href="/assets/extra-1.js">
    <link rel="preload" as="font" href="/fonts/a.woff2" crossorigin>
    <link rel="stylesheet" crossorigin href="/assets/index-Def456.css">
  </head>
  <body><div id="root"></div><SCRIPT src="/assets/upper.js"></SCRIPT><script>/* inline */</script></body>
</html>`;

const HTML_TYPE = "text/html; charset=utf-8";

function assets(body: string | null, init: ResponseInit = {}): Env["ASSETS"] & { calls: Request[] } {
  const calls: Request[] = [];
  return {
    calls,
    async fetch(request: Request) {
      calls.push(request);
      return new Response(body, { status: 200, ...init, headers: { "Content-Type": HTML_TYPE, ETag: '"abc"', ...(init.headers as Record<string, string>) } });
    },
  };
}

const get = (path = "/app", init?: RequestInit) => new Request(`https://satis-manager.com${path}`, init);

async function serve(body: string | null, env: Partial<Env> = {}, request = get()) {
  const response = await handle(request, { ASSETS: assets(body), ...env }, FakeRewriter);
  return { response, html: body === null ? "" : await response.text() };
}

const nonceOf = (csp: string) => /'nonce-([^']+)'/.exec(csp)?.[1];
const scriptTags = (html: string) => html.match(/<script\b[^>]*>/gi) ?? [];
const NONCE_FORMAT = /^[A-Za-z0-9+/]{22}==$/;

describe("the entry module", () => {
  it("exports only its default handler: workerd refuses to start on any other export of the entry", async () => {
    expect(Object.keys(await import("./index"))).toEqual(["default"]);
  });
});

describe("makeNonce", () => {
  it("is 128 random bits in base64, which CSP's nonce grammar accepts", () => {
    const nonce = makeNonce();
    expect(nonce).toMatch(NONCE_FORMAT);
    expect(Buffer.from(nonce, "base64")).toHaveLength(NONCE_BYTES);
  });

  it("never repeats", () => {
    const nonces = new Set(Array.from({ length: 2000 }, makeNonce));
    expect(nonces.size).toBe(2000);
  });
});

describe("adsEnabled (the off switch, default off)", () => {
  it.each([undefined, "false", "", "TRUE", "True", "1", "yes", " true"])("is off for %j", (value) => {
    expect(adsEnabled({ ASSETS: assets(""), ADS_ENABLED: value })).toBe(false);
  });

  it('is on only for the exact string "true"', () => {
    expect(adsEnabled({ ASSETS: assets(""), ADS_ENABLED: "true" })).toBe(true);
  });

  it("is off in wrangler.jsonc", () => {
    expect(readFileSync(join(import.meta.dirname, "../wrangler.jsonc"), "utf8")).toMatch(/"ADS_ENABLED":\s*"false"/);
  });
});

describe("HTML responses", () => {
  it("put the same fresh nonce on every script tag and script preload, and nowhere else", async () => {
    const { response, html } = await serve(VITE_HTML, { ADS_ENABLED: "true" });
    const nonce = nonceOf(response.headers.get("Content-Security-Policy") ?? "");
    expect(nonce).toMatch(NONCE_FORMAT);
    const scripts = scriptTags(html);
    expect(scripts).toHaveLength(3);
    for (const tag of scripts) expect(tag).toContain(`nonce="${nonce}"`);
    expect(html).toContain(`<link rel="modulepreload" crossorigin href="/assets/zod-XyZ789.js" nonce="${nonce}">`);
    expect(html).toContain(`<link rel="preload" as="script" href="/assets/extra-1.js" nonce="${nonce}">`);
    expect(html.match(/nonce="/g)).toHaveLength(5);
  });

  it("send exactly today's policy while off, still nonced (harmless: the policy names no nonce)", async () => {
    const { response, html } = await serve(VITE_HTML, { ADS_ENABLED: "false" });
    expect(response.headers.get("Content-Security-Policy")).toBe(OFF_POLICY);
    for (const tag of scriptTags(html)) expect(tag).toMatch(/ nonce="[A-Za-z0-9+/]{22}=="/);
  });

  it("send the ads-on policy with the tags' nonce when on", async () => {
    const { response, html } = await serve(VITE_HTML, { ADS_ENABLED: "true" });
    const nonce = /<script[^>]* nonce="([^"]+)"/.exec(html)![1];
    expect(response.headers.get("Content-Security-Policy")).toBe(onPolicy(nonce));
  });

  it("get a different nonce on every response", async () => {
    const nonces = new Set<string>();
    for (let i = 0; i < 20; i++) {
      const { response } = await serve(VITE_HTML, { ADS_ENABLED: "true" });
      nonces.add(nonceOf(response.headers.get("Content-Security-Policy") ?? "")!);
    }
    expect(nonces.size).toBe(20);
  });

  it("replace a nonce already in the HTML rather than keep it", async () => {
    const { html } = await serve(`<script nonce="planted" src="/a.js"></script>`, { ADS_ENABLED: "true" });
    expect(html).not.toContain("planted");
  });

  it("carry every security header of public/_headers", async () => {
    const { response } = await serve(VITE_HTML);
    for (const [name, value] of SECURITY_HEADERS) expect(response.headers.get(name)).toBe(value);
  });

  it("overwrite a weaker header the asset response carried", async () => {
    const env = { ASSETS: assets(VITE_HTML, { headers: { "Content-Security-Policy": "script-src *", "X-Frame-Options": "ALLOWALL" } }) };
    const response = await handle(get(), env, FakeRewriter);
    expect(response.headers.get("Content-Security-Policy")).toBe(OFF_POLICY);
    expect(response.headers.get("X-Frame-Options")).toBe("DENY");
  });

  it("drop the asset's ETag and are not stored by shared caches", async () => {
    const { response } = await serve(VITE_HTML);
    expect(response.headers.get("ETag")).toBeNull();
    expect(response.headers.get("Cache-Control")).toBe("private, no-cache");
  });

  it("keep the status and content type (the SPA fallback is a 200 index.html)", async () => {
    const { response } = await serve(VITE_HTML);
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe(HTML_TYPE);
  });

  it("recognise text/html whatever its case or parameters", async () => {
    for (const type of ["text/html", "TEXT/HTML; charset=UTF-8", "text/html;charset=utf-8"]) {
      const env = { ASSETS: assets(VITE_HTML, { headers: { "Content-Type": type } }) };
      const response = await handle(get(), env, FakeRewriter);
      expect(response.headers.get("Content-Security-Policy"), type).toBe(OFF_POLICY);
    }
  });

  it("answer HEAD with the headers and no body", async () => {
    const env = { ASSETS: assets(null) };
    const response = await handle(get("/app", { method: "HEAD" }), env, FakeRewriter);
    expect(response.headers.get("Content-Security-Policy")).toBe(OFF_POLICY);
    expect(response.body).toBeNull();
  });

  it.each(["../index.html", "../public/privacy.html", "../public/terms.html"])("nonce every script in %s", async (path) => {
    const source = readFileSync(join(import.meta.dirname, path), "utf8");
    const { response, html } = await serve(source, { ADS_ENABLED: "true" });
    const nonce = nonceOf(response.headers.get("Content-Security-Policy") ?? "");
    expect(scriptTags(html)).toHaveLength(scriptTags(source).length);
    for (const tag of scriptTags(html)) expect(tag).toContain(`nonce="${nonce}"`);
  });
});

describe("conditional requests", () => {
  it("turn a 304 for an HTML page into a full, freshly nonced response", async () => {
    const calls: Request[] = [];
    const env: Env = {
      ASSETS: {
        async fetch(request) {
          calls.push(request);
          if (request.headers.get("If-None-Match")) return new Response(null, { status: 304, headers: { ETag: '"abc"' } });
          return new Response(VITE_HTML, { headers: { "Content-Type": HTML_TYPE } });
        },
      },
    };
    const response = await handle(get("/app", { headers: { "If-None-Match": '"abc"', "If-Modified-Since": "Sat, 01 Nov 2026 00:00:00 GMT" } }), env, FakeRewriter);
    expect(response.status).toBe(200);
    expect(calls).toHaveLength(2);
    expect(calls[1].headers.get("If-Modified-Since")).toBeNull();
    expect(await response.text()).toMatch(/<script[^>]* nonce="/);
  });

  it("pass a 304 for a file that isn't HTML through as it came", async () => {
    const notModified = new Response(null, { status: 304 });
    const env: Env = {
      ASSETS: {
        async fetch(request) {
          return request.headers.get("If-None-Match") ? notModified : new Response("{}", { headers: { "Content-Type": "application/json" } });
        },
      },
    };
    const response = await handle(get("/x.json", { headers: { "If-None-Match": '"abc"' } }), env, FakeRewriter);
    expect(response.status).toBe(304);
    expect(response.body).toBeNull();
    for (const [name, value] of SECURITY_HEADERS) expect(response.headers.get(name)).toBe(value);
  });
});

/** Today's headers (public/_headers, CSP included), as static serving put them on every response before the Worker. */
function expectTodaysHeaders(response: Response) {
  for (const [name, value] of SECURITY_HEADERS) expect(response.headers.get(name), name).toBe(value);
}

describe("anything that isn't HTML", () => {
  it.each([
    ["application/javascript", "console.log(1)"],
    ["text/css", "body{}"],
    ["application/manifest+json", "{}"],
    ["text/plain", "<script>not html</script>"],
    ["", "no type"],
  ])("keeps its status, body and own headers, with today's security headers added (%s)", async (type, body) => {
    const original = new Response(body, { status: 200, headers: type ? { "Content-Type": type, ETag: '"e"' } : { ETag: '"e"' } });
    const env: Env = { ASSETS: { fetch: async () => original } };
    const response = await handle(get("/new-file"), env, FakeRewriter);
    expect(response.status).toBe(200);
    expect(response.headers.get("ETag")).toBe('"e"');
    expect(response.headers.get("Cache-Control")).toBeNull();
    if (type) expect(response.headers.get("Content-Type")).toBe(type);
    expectTodaysHeaders(response);
    expect(response.headers.get("Content-Security-Policy")).toBe(OFF_POLICY);
    expect(await response.text()).toBe(body);
  });

  it("includes redirects (/privacy.html is a 307 to /privacy, E5), which keep HSTS and the rest", async () => {
    const redirect = new Response(null, { status: 307, headers: { Location: "/privacy" } });
    const env: Env = { ASSETS: { fetch: async () => redirect } };
    const response = await handle(get("/privacy.html"), env, FakeRewriter);
    expect(response.status).toBe(307);
    expect(response.headers.get("Location")).toBe("/privacy");
    expectTodaysHeaders(response);
  });

  it("gets today's CSP even with ads on: only HTML carries a nonce", async () => {
    const env: Env = { ASSETS: { fetch: async () => new Response("{}", { headers: { "Content-Type": "application/json" } }) }, ADS_ENABLED: "true" };
    expect((await handle(get("/x.json"), env, FakeRewriter)).headers.get("Content-Security-Policy")).toBe(OFF_POLICY);
  });
});

describe("the default export", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("uses the runtime's HTMLRewriter and forwards the request to the assets binding", async () => {
    vi.stubGlobal("HTMLRewriter", FakeRewriter);
    const binding = assets(VITE_HTML);
    const request = get("/app/power");
    const response = await worker.fetch(request, { ASSETS: binding, ADS_ENABLED: "false" });
    expect(binding.calls).toEqual([request]);
    expect(response.headers.get("Content-Security-Policy")).toBe(OFF_POLICY);
    expect(await response.text()).toMatch(/<script[^>]* nonce="/);
  });
});

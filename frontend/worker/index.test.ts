import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import worker from "./index";
import { AD_CLIENT, ADS_MARKER_CONTENT, ADS_MARKER_NAME, ADSENSE_LOADER_URL } from "../src/ads/config";
import { adsEnabled, adsHead, handle, makeNonce, NONCE_BYTES, type Env } from "./handle";
import { OFF_POLICY, onPolicy, SECURITY_HEADERS } from "./securityHeaders";
import { FakeRewriter } from "./testRewriter";

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
    // The page's three, plus the AdSense loader the Worker inserts with ads on.
    expect(scripts).toHaveLength(4);
    for (const tag of scripts) expect(tag).toContain(`nonce="${nonce}"`);
    expect(html).toContain(`<link rel="modulepreload" crossorigin href="/assets/zod-XyZ789.js" nonce="${nonce}">`);
    expect(html).toContain(`<link rel="preload" as="script" href="/assets/extra-1.js" nonce="${nonce}">`);
    expect(html.match(/nonce="/g)).toHaveLength(6);
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
    // Every page has a <head>, so each gets the AdSense loader too while ads are on.
    expect(scriptTags(html)).toHaveLength(scriptTags(source).length + 1);
    for (const tag of scriptTags(html)) expect(tag).toContain(`nonce="${nonce}"`);
  });
});

/** The AdSense loader's tag in a page, if any. */
const loaderTags = (html: string) => scriptTags(html).filter((tag) => tag.includes("googlesyndication"));
const MARKER = `<meta name="${ADS_MARKER_NAME}" content="${ADS_MARKER_CONTENT}">`;

describe("the AdSense loader and the ads marker (build step 4)", () => {
  it("are inserted once, at the end of <head>, with the page's nonce, async and crossorigin as Google documents (E1)", async () => {
    const { response, html } = await serve(VITE_HTML, { ADS_ENABLED: "true" });
    const nonce = nonceOf(response.headers.get("Content-Security-Policy") ?? "")!;
    expect(loaderTags(html)).toEqual([`<script nonce="${nonce}" async src="${ADSENSE_LOADER_URL}" crossorigin="anonymous">`]);
    expect(html.split(MARKER)).toHaveLength(2);
    const head = html.slice(html.indexOf("<head>"), html.indexOf("</head>"));
    expect(head.endsWith(adsHead(nonce))).toBe(true);
    // After the page's own head: the charset and the stylesheet stay first.
    expect(html.indexOf(MARKER)).toBeGreaterThan(html.indexOf('rel="stylesheet"'));
  });

  it("load Google's documented loader for this site's publisher", () => {
    expect(ADSENSE_LOADER_URL).toBe(`https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${AD_CLIENT}`);
    const capture = readFileSync(join(import.meta.dirname, "../../docs-vault/raw-sources/adsense-csp-and-cmp-2026-11-01.md"), "utf8");
    expect(capture).toContain("//pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-");
  });

  it("name the same publisher as index.html's verification tag and ads.txt", () => {
    const html = readFileSync(join(import.meta.dirname, "../index.html"), "utf8");
    expect(html).toContain(`<meta name="google-adsense-account" content="${AD_CLIENT}" />`);
    const adsTxt = readFileSync(join(import.meta.dirname, "../public/ads.txt"), "utf8");
    expect(adsTxt).toContain(`google.com, ${AD_CLIENT.replace(/^ca-/, "")}, DIRECT`);
  });

  it.each([undefined, "false", "TRUE", "1"])("are not inserted with the switch at %j: no loader, no marker, no Google host", async (value) => {
    const { html } = await serve(VITE_HTML, { ADS_ENABLED: value });
    expect(html).not.toMatch(/googlesyndication|adsbygoogle/);
    expect(html).not.toContain(ADS_MARKER_NAME);
    expect(scriptTags(html)).toHaveLength(3);
  });

  it("leave the page as it was while off, apart from the nonces", async () => {
    const { html } = await serve(VITE_HTML, { ADS_ENABLED: "false" });
    expect(html.replace(/ nonce="[^"]*"/g, "")).toBe(VITE_HTML);
  });

  it("are inserted into the static pages too (privacy, terms), which carry no slots", async () => {
    for (const path of ["../public/privacy.html", "../public/terms.html"]) {
      const { html } = await serve(readFileSync(join(import.meta.dirname, path), "utf8"), { ADS_ENABLED: "true" });
      expect(loaderTags(html), path).toHaveLength(1);
      expect(html, path).toContain(MARKER);
    }
  });

  it("are not inserted into a page without a <head>, nor into anything that isn't HTML", async () => {
    expect(loaderTags((await serve("<p>fragment</p>", { ADS_ENABLED: "true" })).html)).toEqual([]);
    const env: Env = { ASSETS: { fetch: async () => new Response("<head></head>", { headers: { "Content-Type": "text/plain" } }) }, ADS_ENABLED: "true" };
    expect(await (await handle(get("/x.txt"), env, FakeRewriter)).text()).toBe("<head></head>");
  });

  it("get a nonce in the base64 alphabet, safe inside the double-quoted attribute", async () => {
    for (let i = 0; i < 50; i++) {
      const { html } = await serve(VITE_HTML, { ADS_ENABLED: "true" });
      expect(loaderTags(html)[0]).toMatch(/^<script nonce="[A-Za-z0-9+/]{22}==" async /);
    }
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

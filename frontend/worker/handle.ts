// The main site's Worker logic (ADR-0021 amendment 3, build steps 2 and 4; the entry is index.ts): runs in front of the HTML pages only (wrangler.jsonc's
// `run_worker_first` leaves the static files out), gives each HTML response a fresh nonce on every script, and sends
// the CSP. With ADS_ENABLED anything but "true" (the default, "false"), the CSP is exactly today's `_headers` policy
// and nothing is inserted; with "true", the ads-on policy and the AdSense loader plus its marker in <head> (adsHead).
// Not used by the demo site (demo/wrangler.jsonc has no Worker). Citations: cloudflare-workers-assets-worker-2026-11-01.md.
import { ADS_MARKER_CONTENT, ADS_MARKER_NAME, ADSENSE_LOADER_URL } from "../src/ads/config";
import { OFF_POLICY, onPolicy, SECURITY_HEADERS } from "./securityHeaders";
import type { HTMLRewriterConstructor, RewriterElement } from "./htmlRewriter";

export interface Env {
  /** The static assets binding (E3). */
  ASSETS: { fetch(request: Request): Promise<Response> };
  /** The ads switch (wrangler.jsonc `vars`, E7). Only the exact string "true" turns the ads-on policy on. */
  ADS_ENABLED?: string;
}

/** 16 random bytes (128 bits), base64: CSP's nonce grammar allows base64's alphabet and padding. */
export const NONCE_BYTES = 16;

export function makeNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(NONCE_BYTES));
  return btoa(String.fromCharCode(...bytes));
}

export function adsEnabled(env: Env): boolean {
  return env.ADS_ENABLED === "true";
}

function isHtml(response: Response): boolean {
  return /^text\/html(\s*;|$)/i.test(response.headers.get("Content-Type") ?? "");
}

/** Elements that load script and so carry the nonce: every `<script>`, and script preloads (Vite's modulepreload). */
export function loadsScript(element: Pick<RewriterElement, "tagName" | "getAttribute">): boolean {
  if (element.tagName.toLowerCase() === "script") return true;
  const rel = (element.getAttribute("rel") ?? "").toLowerCase().split(/\s+/);
  if (rel.includes("modulepreload")) return true;
  return rel.includes("preload") && (element.getAttribute("as") ?? "").toLowerCase() === "script";
}

/**
 * Ask the assets for the response. A conditional request can come back 304, which has no body to rewrite and would
 * keep the browser's copy with an old nonce, so a 304 is asked again unconditionally; it is returned as it came only
 * when the full response is not HTML.
 */
async function fetchAsset(request: Request, env: Env): Promise<Response> {
  const response = await env.ASSETS.fetch(request);
  if (response.status !== 304) return response;
  const unconditional = new Request(request);
  for (const name of ["If-None-Match", "If-Modified-Since"]) unconditional.headers.delete(name);
  const full = await env.ASSETS.fetch(unconditional);
  return isHtml(full) ? full : response;
}

/**
 * The asset response with `_headers`' rules set on it, exactly as static serving would send them: whether a response
 * the Worker returns from `env.ASSETS.fetch` still carries them is not documented (E4), so they are set either way.
 */
function withSecurityHeaders(asset: Response): Response {
  const response = new Response(asset.body, asset);
  for (const [name, value] of SECURITY_HEADERS) response.headers.set(name, value);
  return response;
}

export async function handle(request: Request, env: Env, Rewriter: HTMLRewriterConstructor): Promise<Response> {
  const asset = await fetchAsset(request, env);
  // Anything that isn't HTML (a redirect such as /privacy.html to /privacy, a 304, a file the run_worker_first list
  // missed) keeps its status and body, and gets today's headers, CSP included, as `_headers` gave it before the Worker.
  if (!isHtml(asset)) return withSecurityHeaders(asset);

  const nonce = makeNonce();
  const response = withSecurityHeaders(asset);
  response.headers.set("Content-Security-Policy", adsEnabled(env) ? onPolicy(nonce) : OFF_POLICY);
  // The body now differs per response: the asset's ETag and length no longer describe it, and no shared cache may
  // hand one visitor's nonce to another.
  response.headers.delete("ETag");
  response.headers.delete("Content-Length");
  response.headers.set("Cache-Control", "private, no-cache");
  if (!response.body) return response;

  const addNonce = {
    element(element: RewriterElement) {
      if (loadsScript(element)) element.setAttribute("nonce", nonce);
    },
  };
  const rewriter = new Rewriter().on("script", addNonce).on("link", addNonce);
  // Ads on: the AdSense loader (which also deploys Google's consent messages) and the marker the app reads, at the end
  // of <head>. Ads off: nothing is inserted, so the page is byte for byte what it was, nonces aside.
  if (adsEnabled(env)) {
    rewriter.on("head", {
      element(element: RewriterElement) {
        element.append(adsHead(nonce), { html: true });
      },
    });
  }
  return rewriter.transform(response);
}

/**
 * What the Worker inserts into <head> while ads are on: the marker (`src/ads/config.ts`), then Google's loader with the
 * page's nonce, `async` and `crossorigin="anonymous"` as E1 shows (adsense-csp-and-cmp-2026-11-01.md). The nonce is
 * written here, not by the script handler: inserted HTML may not pass through the handlers (HR-E1's NOT FOUND).
 */
export function adsHead(nonce: string): string {
  return (
    `<meta name="${ADS_MARKER_NAME}" content="${ADS_MARKER_CONTENT}">` +
    `<script nonce="${nonce}" async src="${ADSENSE_LOADER_URL}" crossorigin="anonymous"></script>`
  );
}

// The main site's Worker (ADR-0021 amendment 3, build step 2): runs in front of the HTML pages only (wrangler.jsonc's
// `run_worker_first` leaves the static files out), gives each HTML response a fresh nonce on every script, and sends
// the CSP. With ADS_ENABLED anything but "true" (the default, "false"), the CSP is exactly today's `_headers` policy.
// Not used by the demo site (demo/wrangler.jsonc has no Worker). Citations: cloudflare-workers-assets-worker-2026-11-01.md.
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
export function loadsScript(element: RewriterElement): boolean {
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

export async function handle(request: Request, env: Env, Rewriter: HTMLRewriterConstructor): Promise<Response> {
  const asset = await fetchAsset(request, env);
  // Anything that isn't HTML (a redirect, a file the run_worker_first list missed) goes back untouched.
  if (!isHtml(asset)) return asset;

  const nonce = makeNonce();
  const response = new Response(asset.body, asset);
  for (const [name, value] of SECURITY_HEADERS) response.headers.set(name, value);
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
  return new Rewriter().on("script", addNonce).on("link", addNonce).transform(response);
}

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return handle(request, env, (globalThis as unknown as { HTMLRewriter: HTMLRewriterConstructor }).HTMLRewriter);
  },
};

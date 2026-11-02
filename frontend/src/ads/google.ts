// The two calls the app makes into Google's AdSense code (ADR-0021 amendment 3, build step 4), and how it knows ads are
// on. Nothing here loads a script: the Worker inserts the loader into <head> only while ADS_ENABLED is "true".
import { IS_DEMO } from "../demo/mode";
import { ADS_MARKER_CONTENT, ADS_MARKER_NAME } from "./config";

declare global {
  interface Window {
    /** AdSense's command queue (adsense-csp-and-cmp-2026-11-01.md E9; adsense-ad-units-and-us-states-link U-E5). */
    adsbygoogle?: unknown[];
    /** Google's Privacy & messaging API (E7): only its callbackQueue may be called before the script has loaded. */
    googlefc?: { callbackQueue?: unknown[]; showRevocationMessage?: () => void };
  }
}

/**
 * Ads are on for this page load: the Worker put its marker in <head> (src/ads/config.ts). Never in the demo build,
 * which has no Worker. Read from the document each time: it is fixed for the page's life, and cheap.
 */
export function adsOn(doc: Document = document): boolean {
  if (IS_DEMO) return false;
  return doc.head.querySelector(`meta[name="${ADS_MARKER_NAME}"][content="${ADS_MARKER_CONTENT}"]`) !== null;
}

/**
 * Opens Google's consent message again, so a visitor can change or withdraw their choice: E10's
 * `googlefc.callbackQueue.push(googlefc.showRevocationMessage)`, through the queue as E7 requires ("the only supported
 * way to invoke any function"). The queue is created if Google's script hasn't yet, and the function is looked up when
 * the queue runs it, so a click before the script loads still works once it does.
 */
export function showPrivacySettings(win: Window = window): void {
  win.googlefc ??= {};
  win.googlefc.callbackQueue ??= [];
  win.googlefc.callbackQueue.push(() => win.googlefc?.showRevocationMessage?.());
}

/**
 * Asks AdSense to fill the ad unit just rendered: `(adsbygoogle = window.adsbygoogle || []).push({})` (U-E5). A
 * failure (Google's code throws when there is no unit left to fill, or blocked) leaves the slot empty: no error, no
 * retry (Decision 6).
 */
export function requestAd(win: Window = window): void {
  try {
    (win.adsbygoogle ??= []).push({});
  } catch {
    // Empty on failure, by design.
  }
}

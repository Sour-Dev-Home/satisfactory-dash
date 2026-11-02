// The AdSense set-up in one place (ADR-0021 amendment 3, build step 4). Read by the app (the slots, the footer link)
// and by the Worker (worker/handle.ts), which inserts the loader and the marker below only while ADS_ENABLED is "true".
// Plain data, no DOM: the Worker imports it too.

/** The publisher id: the same as index.html's verification tag and public/ads.txt (worker/index.test.ts checks). */
export const AD_CLIENT = "ca-pub-2932631210238768";

/**
 * Google's loader for the AdSense code, which also deploys the consent messages (adsense-csp-and-cmp-2026-11-01.md,
 * E1, E5-E7). The Worker writes it with the page's nonce, `async` and `crossorigin="anonymous"`, as E1 shows.
 */
export const ADSENSE_LOADER_URL = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${AD_CLIENT}`;

/**
 * The marker the Worker puts in <head> with the loader: `<meta name="satis-ads" content="on">`. The app shows the
 * slots and the consent link only when it is there, so with the switch off nothing renders and nothing is requested.
 */
export const ADS_MARKER_NAME = "satis-ads";
export const ADS_MARKER_CONTENT = "on";

/** The app's ad placements: one slot below the page's panels (Decision 6). None on Map, Settings, Servers, Metrics, login. */
export type AdPlacement = "overview" | "power" | "factory" | "planner";

/**
 * Each placement's AdSense ad unit (`data-ad-slot`). OWNER: these are placeholders. Create one display ad unit per
 * placement in AdSense (Ads > By ad unit > Display ads, Responsive; adsense-ad-units-and-us-states-link-2026-11-01.md,
 * U-E4) and paste its numeric id here. A placement whose unit is `null` renders nothing, even with ads on, so the switch
 * can go on before the units exist (only the consent message then shows).
 */
export const AD_UNITS: Readonly<Record<AdPlacement, string | null>> = {
  overview: null, // OWNER: ad unit id for the Overview slot
  power: null, // OWNER: ad unit id for the Power slot
  factory: null, // OWNER: ad unit id for the Factory slot
  planner: null, // OWNER: ad unit id for the Planner slot
};

/** An ad unit id as AdSense shows it: digits only. Anything else is never written into the page. */
export function isAdUnitId(value: string | null | undefined): value is string {
  return typeof value === "string" && /^\d{1,20}$/.test(value);
}

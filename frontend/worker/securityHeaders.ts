// The main site's security headers for the HTML the Worker serves (ADR-0021 amendment 3, build step 2).
//
// One policy, two carriers: `public/_headers` stays the source for static assets and for `vite preview` (e2e), and
// this module carries the same `/*` rules for the Worker, because `_headers` is not applied to responses a Worker
// returns (docs-vault/raw-sources/cloudflare-workers-assets-worker-2026-11-01.md, E4). `securityHeaders.test.ts`
// fails unless the two hold exactly the same headers and values, so they cannot drift: change both together.

/** Today's `/*` rules from `public/_headers`, in its order. Pairs, not an object: header names are not looked up. */
export const SECURITY_HEADERS: readonly (readonly [name: string, value: string])[] = [
  [
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; font-src 'self'; connect-src 'self' https://api.satis-manager.com; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; manifest-src 'self'",
  ],
  ["Strict-Transport-Security", "max-age=31536000; includeSubDomains"],
  ["X-Content-Type-Options", "nosniff"],
  ["X-Frame-Options", "DENY"],
  ["Referrer-Policy", "strict-origin-when-cross-origin"],
  ["Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()"],
  ["Cross-Origin-Opener-Policy", "same-origin"],
];

const CSP_HEADER = "Content-Security-Policy";

/** The CSP sent while ads are off: exactly today's `_headers` policy (Decision 3, the off switch). */
export const OFF_POLICY: string = SECURITY_HEADERS.find(([name]) => name === CSP_HEADER)![1];

/**
 * Google's supported strict script policy (adsense-csp-and-cmp-2026-11-01.md, E1 and E2), with the nonce filled in.
 * Browsers that support 'strict-dynamic' ignore the host and 'unsafe-inline' parts.
 */
export function strictScriptSrc(nonce: string): string {
  return `'nonce-${nonce}' 'unsafe-inline' 'unsafe-eval' 'strict-dynamic' https: http:`;
}

/**
 * The directives the ads-on policy changes from today's (ADR-0021 amendment 3, Decision 1; build step 4). Google
 * supports only its strict script policy and documents no host for frames, images, styles or connections (E1, E2; its
 * example sets no `default-src`, so those are unrestricted there), and the hosts "change over time" (E1). So each
 * fetch the ad code makes from the page is opened to any https origin, and nothing else is loosened:
 * - `script-src`: Google's policy, word for word (E1).
 * - `style-src`: the ad code and Google's consent message write inline styles; Google's example does not restrict them.
 * - `img-src`, `connect-src`, `frame-src`, `font-src`, `media-src`: any https origin (creatives, beacons, ad and consent
 *   iframes, fenced frames). `data:` images for creatives. The API origin is covered by `https:`.
 * - `worker-src 'self'`: kept explicit (it fell back to `default-src`), so the push service worker stays first-party.
 * `default-src 'self'` stays for anything not listed (`manifest-src`, `child-src`...), with `object-src 'none'` and
 * `base-uri 'none'` (E1), `form-action 'self'` and `frame-ancestors 'none'`. A directive that breaks the ads in staging
 * is loosened, not worked around (Decision 1). No `report-uri`: E1's example has one, but this site has no endpoint to
 * receive reports, so it is left out until one exists.
 */
export const ON_POLICY_OVERRIDES: readonly (readonly [string, string])[] = [
  ["style-src", "'self' 'unsafe-inline'"],
  ["img-src", "'self' https: data:"],
  ["font-src", "'self' https:"],
  ["connect-src", "'self' https:"],
  ["frame-src", "https:"],
  ["media-src", "'self' https:"],
  ["worker-src", "'self'"],
  ["object-src", "'none'"],
  ["base-uri", "'none'"],
];

/** The CSP sent while ads are on: today's policy with Google's strict `script-src` and the overrides above. */
export function onPolicy(nonce: string): string {
  return withDirectives(OFF_POLICY, [["script-src", strictScriptSrc(nonce)], ...ON_POLICY_OVERRIDES]);
}

/** `policy` with each named directive's value replaced, or appended when the policy lacks it. */
export function withDirectives(policy: string, overrides: readonly (readonly [string, string])[]): string {
  const directives = policy
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const space = part.indexOf(" ");
      return space === -1 ? [part, ""] : [part.slice(0, space), part.slice(space + 1).trim()];
    });
  for (const [name, value] of overrides) {
    const existing = directives.find(([directive]) => directive.toLowerCase() === name);
    if (existing) existing[1] = value;
    else directives.push([name, value]);
  }
  return directives.map(([name, value]) => (value ? `${name} ${value}` : name)).join("; ");
}

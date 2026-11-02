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
 * NOT YET USED: the ads-on policy is a starting point only. Build step 4 sets its other directives (frames, images,
 * connections for the ads), proves them in e2e and staging, and has `security-reviewer` review them. Until then it is
 * today's policy with `script-src` replaced by Google's, and `object-src 'none'` and `base-uri 'none'` (E1) kept.
 */
export function onPolicy(nonce: string): string {
  return withDirectives(OFF_POLICY, [
    ["script-src", strictScriptSrc(nonce)],
    ["object-src", "'none'"],
    ["base-uri", "'none'"],
  ]);
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

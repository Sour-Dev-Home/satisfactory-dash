# ADR-0026: Demo mode (a public, offline demo that can never reach the real API)

Status: accepted (project owner), 2026-09-24, including the demo.satis-manager.com subdomain.

## Context
- The game server stays on the owner's PC (owner decision, 2026-09-24), so the live dashboard
  is often unreachable. The product must be demonstrable with no login, backend or game server,
  for the portfolio, README and LinkedIn.
- A dev-only mock mode exists (#55): MSW in a service worker, enabled by `MODE === 'mock'`, a
  build-time constant (frontend/src/main.tsx:11-16). A mock *build* is refused on purpose
  (frontend/vite.config.ts:47-49), and e2e/build-output.spec.ts:18-27 asserts the production
  bundle ships no mock code or fixture markers.
- Every API call goes through one module: `fetch(BASE_URL + path)` with credentials
  (frontend/src/api/client.ts:9, :83).
- The CSP comes from the build's own `public/_headers`. Production allows
  `connect-src 'self' https://api.satis-manager.com`.
- The shared fixtures (packages/shared/fixtures) are test-shaped (edge cases, error states,
  "Modded Widget"), not a presentable factory. They contain no personal data.

## Decision
1. **A separate build on a separate origin**: `vite build --mode demo`, deployed as its own
   Workers static-assets project (`satisfactory-dash-demo`) at **demo.satis-manager.com**. The
   main site, the README and the portfolio link to it. Not a `/demo` path on the main site, because:
   - the main document's CSP must allow the API origin, and a single-page app can't reliably
     give one client-side route a stricter CSP;
   - the production bundle stays free of demo and mock code (the existing build-output invariant);
   - a separate origin never holds the real session cookie or the real app's storage.
2. **A transport seam in the API client**: client.ts sends through a `transport(path, init)`
   chosen at build time.
   - Production: `fetch` to `VITE_API_URL`.
   - Demo: an in-process resolver that never touches the network.
   - No service worker in the demo: service workers are unavailable in some private modes and
     in-app browsers, and those are where a LinkedIn or portfolio link gets opened.
   - Resolution: msw 2.15's `getResponse(handlers, request, resolutionContext?)` resolves a
     Request with no service worker (verified by the frontend session, 2026-09-24). An unmatched
     request returns `undefined`, which the demo transport turns into a visible "demo has no data
     for <path>" error. The resolver passes the base URL explicitly (relative handler paths only
     match against a page origin), so unit tests and the browser behave the same.
   - The demo reuses MSW's handler format and `getResponse`, **not** #55's test scenarios.
     Separate demo handlers serve the curated demo world; the test scenarios keep their error
     cases and markers, test-only.
   - *Amendment (#113, 2026-09-24):* an in-house router (`frontend/src/demo/router.ts`) with the
     same handler shape replaces `getResponse`. MSW core pulls in tough-cookie and the public
     suffix list, which would add about 330 kB to the demo chunk (786 kB vs 459 kB). An unmatched
     request returns a visible 404 and a handler error a 500, both in the contract's error shape;
     there is no network path. Additional guards: a transport-name marker (present in the prod
     bundle, absent from the demo), a build error on any other import of the real transport, and
     the rule that the CSP and the build, not lint, are the boundary for indirect forms.
   - `MODE` stays a build-time constant, so each bundle contains only its own transport.
3. **"Never calls the real API": four independent layers, each tested**
   1. Build: the demo build defines no `VITE_API_URL`. A build-output test fails if the demo
      bundle contains `api.satis-manager.com` or the real transport. The existing test keeps
      failing if the production bundle contains demo or mock code.
   2. Code: the demo transport is the only transport in that bundle. An unmatched path throws a
      visible error and never falls through to `fetch`.
   3. Browser: the demo's own `_headers` sets `connect-src 'self'` (no API origin), plus the same
      strict script-src and the other headers. The browser blocks the API even if code tries.
   4. E2E: a Playwright project runs against the built demo, served with its real `_headers`. It
      asserts every request stays on the demo origin, zero CSP violations, and that a route to
      the API origin is never hit.
4. **UX**
   - A permanent, non-dismissable "Demo data: nothing here is live" banner.
   - "Login" is an **Enter demo** button with no credential form, so nobody types a real
     password into the demo.
   - Writes (auto-pause) change in-memory state through the same pending-then-done UI; a reload
     resets everything.
   - Data comes from a **curated demo world** in `frontend/src/demo/`, derived from the captures
     and validated against the shared zod schemas in a unit test, so it can't drift from the
     contract. The test fixtures stay test-shaped.
   - The power history is generated deterministically from a seeded function of time, so the
     chart moves. `?clock=fixed` freezes time for reproducible renders.
5. **Walkthrough video**
   - `npm run demo:video` is a Playwright script: Enter demo, then overview, power chart,
     factory, and auto-pause toggled with its pending state.
   - Timing: 60-90 s at 1920x1080, with deliberate pauses, and `page.clock` to control time.
   - Output: WebM converted to MP4 (H.264), plus a poster PNG.
   - CI: a `workflow_dispatch`-only job uploads them as an artifact (30 days), never on every
     PR. The published copies go to the portfolio and to a GitHub Release asset that the README
     links.
6. **Definition of done from now on**: every new user-facing screen or endpoint ships with its
   demo data and resolver entry, and the demo e2e smoke visits it. Otherwise the demo rots.

## Ownership
- Frontend session: everything under `frontend/`: the transport seam, demo mode, the demo world,
  the banner, the Enter demo button, `_headers` for demo, the wrangler config for the demo
  project, the build-output and demo e2e tests, and the video script.
- Coordinator: the DNS record, the demo deploy job and the video job.
- Dev: commits this ADR.

## Consequences
- A second deploy target (a free Workers project and one DNS record).
- The demo is a maintained product surface (item 6).
- The demo world must stay presentable and free of personal data (no real player or session
  names).

## Revisit when
- Demo e2e failures show drift more than occasionally: generate the demo world from the shared
  fixtures instead of curating it.
- A read-only public showcase server ever exists: the demo still stays offline. That would be a
  separate decision.

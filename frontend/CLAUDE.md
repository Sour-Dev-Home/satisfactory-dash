# frontend/

See the root `CLAUDE.md` for project-wide rules. This module is the Vite + React +
TypeScript SPA.

## Ownership boundary

This is the "frontend" module for future multi-agent work: an agent scoped to this
directory should never need to know FRM/vanilla-API response shapes, database schema,
or polling logic — only the types exported from `@satisfactory-dash/shared` and
whatever REST/WebSocket endpoints `backend/` documents. If you find yourself reaching
for a type or shape that isn't in `@satisfactory-dash/shared`, that's a signal the
contract needs to grow, not that this module should special-case a backend detail.

## Conventions

- Plain client-side React (hooks, components) — no server components, no file-based
  routing framework.
- Routing (ADR-0016 item 4, ADR-0021): React Router in declarative mode (`BrowserRouter` in
  `App.tsx`). The signed-in app lives under `/app/*` (`src/shell/Shell.tsx`: tabs Overview,
  Power, Factory, Map, Settings, plus Servers for the operator only: ADR-0030, `src/serverManagement/`,
  shown when the server list says `canManageServers`; tokens are write-only there, never prefilled or
  shown beyond their last 4). `/` is the static landing page (`src/landing/`, main site only;
  the demo's `/` is "Enter demo"); any other path redirects to `/app`, keeping the query
  string. Keep `/` and future public paths (`/guides/*`, `/changelog`) free of app code: no
  queries, no auth, no API calls (`e2e/landing.spec.ts`). Its link-preview tags are static
  in `index.html` (previews don't run JavaScript); `og:image` is `public/og-image.png`, the
  demo video's poster (`npm run demo:video`).
  Link with absolute `/app/...` paths. Every page element in `Shell` needs its own `key`, or
  React reuses the previous page's crash boundaries.
- Styling (ADR-0016 items 2-3): Tailwind v4, tokens in `@theme` in `src/index.css`
  (direction B2, dark only). Use the token utilities (`bg-surface`, `text-muted`,
  `text-ok`, `min-h-touch`...). Every colour, size, radius, z-index, breakpoint and motion
  value (duration, easing, delay) is a named token in that `@theme` block, never a raw value
  in a component: no hex, no `min-h-[44px]`, no `z-10`, no `180ms`. Need a new value? Add
  the token first. Tailwind's own scale (`p-4`, `rounded-md`, `sm:`) counts as tokens.
  `npm run lint` (`scripts/check-design-tokens.mjs`) fails on raw values outside `@theme`;
  the escape hatch is `design-token-allow: <reason>` on or above the line, plus bumping
  `ALLOWED_EXCEPTIONS` in that script so a reviewer sees it. `cn()` in `src/lib/cn.ts` merges
  classes. shadcn/ui components get copied into `src/components/ui/` only when a view needs
  one; prefer non-modal variants (ADR-0016 item 8). The old `.panel`/`.banner`/`.circuit`
  classes in `index.css` are there until each view is restyled (step 5), then deleted.
- The Overview's status-page summary (`src/overview/health.ts`) only aggregates what the
  backend classified. Its one rule of its own: Factory is degraded above
  `BACKED_UP_DEGRADED_SHARE` (25%, the owner's pick).
- `src/api/client.ts` builds every API request and `src/api/transport.ts` sends it, the
  only place that calls `fetch` (oxlint's `no-restricted-globals` enforces it; ADR-0026's
  demo build swaps the transport). Use `apiGet`/`apiSend` with
  an entry from `endpoints`; they parse every body with the shared schema and throw
  `ApiError`, `ContractDriftError` or `BackendUnreachableError` (`src/api/errors.ts`).
  Components read data through the TanStack Query options in `src/api/queries.ts`.
- Auth (ADR-0011): `src/auth/AuthGate.tsx` shows the app only when the session query says
  signed in. A 401 from any query or mutation (except login) signs out in one place,
  `createQueryClient`; screens never handle 401 themselves. Nothing auth-related goes in
  localStorage: the httpOnly cookie is the only credential.
- Servers (ADR-0001): `src/servers/ServerGate.tsx` picks the server; views read it with
  `useSelectedServer()` and key queries by its id. `server_not_found` from any query for
  that server is handled there too (drop the selection, rediscover, never auto-select the
  lost id again). Show errors with `components/ErrorNotice.tsx` so wording stays consistent.
- Views (e.g. `src/status/`): a presentational component that takes schema types as
  props (`StatusPanel({ snapshot })`), plus a thin container that runs the `useQuery`.
  Views read data only through the query layer, never their own fetch, so a future push
  path (ADR-0014) can fill the same cache keys. Display formatting lives in the pure
  helpers in `src/format.ts`; they round, never change units (ADR-0006). No view
  registry; the map has the only plug-in contract.
- Map (ADR-0023, `src/map/`): Leaflet with CRS.Simple, in a lazy chunk (`MapCanvas.tsx`) that
  only the Map page loads. `projection.ts` is the one world-to-map mapping (`[lat, lng] =
  [-yM, xM]`; bounds cited from docs-vault/raw-sources/world-coordinates.md); base maps are
  configs (v1: a neutral grid, no game art). A layer is a `MapLayer` (`layers.ts`): it gets
  Leaflet through its `MapContext` (never imports it at runtime), draws on the shared canvas
  renderer, returns its cleanup, and supplies a legend and a text `describe`. Tooltip content
  is built from text nodes, never an HTML string (names come from the game server). Every
  layer's data is also shown as text (the buildings-in-view table). `e2e/map.spec.ts` is the
  CSP gate (pan, zoom, hover, toggle); Leaflet overrides in `index.css` are unlayered.
- `VITE_API_URL` (see `.env.example`) is the backend origin in production and empty in
  development, where Vite proxies `/api` to the local backend. Never hardcode
  `localhost:3001` in `src/`.
- Tests: Vitest + React Testing Library (`npm run test`). New components should get a
  test that renders them and asserts on user-visible behavior, not implementation
  details. API calls are mocked with MSW (`src/test/`), using handlers built only from
  `@satisfactory-dash/shared/fixtures`. Override a route per test with `server.use(...)`.
- Fixtures never reach production code: `oxlint` rejects any import of
  `@satisfactory-dash/shared/fixtures` outside `src/test/`, `e2e/` and `*.test.*` files.
- UI states live in `src/test/scenarios.ts` (built only from the shared fixtures). Two
  consumers, one source:
  - `npm run dev:mock -w frontend`: the dev server with the API mocked in the browser (MSW);
    pick a state with `/app?scenario=<name>` (`/` is the landing page). Use it with the Playwright MCP and the ui-reviewer.
    The MSW worker is served by a Vite plugin in mock mode only, never from `public/`.
  - `npm run e2e -w frontend` (ADR-0016 item 5): Playwright against the production build,
    served by `vite preview` with `public/_headers`, at 1440 and 390 px. Every test fails on
    a CSP violation or an unmocked `/api` call, with no exceptions: zod's eval probe is off
    because `main.tsx` imports `@satisfactory-dash/shared/browser` first (keep it first; a
    test enforces it). Any axe WCAG 2.1 AA violation fails the test. Screenshot
    comparisons run only with `PLAYWRIGHT_SNAPSHOTS=1` (CI's Linux image; fonts differ per OS).
  A new UI state gets a scenario and a case in `e2e/states.spec.ts` (with `path` when it
  lives on a page other than the Overview).
- Demo build (ADR-0026): `npm run build:demo` (`vite build --mode demo`) into `dist-demo/`,
  for demo.satis-manager.com. `vite.config.ts` swaps `api/transport.ts` for
  `src/demo/transport.ts` (in-page answers from `src/demo/handlers.ts` over the made-up
  world in `src/demo/world.ts`; no network, no service worker) and writes `demo/_headers`
  (`connect-src 'self'`). `IS_DEMO` (`src/demo/mode.ts`) is a build-time constant, so demo
  UI never reaches the production bundle; `e2e/build-output.spec.ts` checks both builds.
  Every new screen or endpoint ships with its demo data and handler. The demo world is
  ours; never reuse the test fixtures there (they're edge cases with test markers).
  The boundary is the demo CSP plus the build (the demo build fails if anything but
  `client.ts` imports `api/transport.ts`); the network lint only keeps new code honest and
  can't see indirect forms like `Reflect.get(window, "fetch")`, which the CSP blocks.
- Deploy: Cloudflare Workers static assets (ADR-0013 amendment), configured by
  `wrangler.jsonc`. Cloudflare's Git build runs `npx wrangler`; it's not a dependency.
  Served on the custom domain only (`workers_dev` and `preview_urls` are off).
- Security headers (CSP, HSTS, etc.) live in `public/_headers` and apply in production
  only. A new external origin (API, font, image) must be added to the CSP there. Never
  add long-cache or `immutable` headers for `/assets/*` while `not_found_handling` is
  `single-page-application`: a missing hashed asset returns 200 `index.html`, and that
  HTML would be cached for a year.

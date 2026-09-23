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
- `src/api/client.ts` is the only place that calls `fetch`. Use `apiGet`/`apiSend` with
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
  registry or plug-in contract until map work starts.
- `VITE_API_URL` (see `.env.example`) is the backend origin in production and empty in
  development, where Vite proxies `/api` to the local backend. Never hardcode
  `localhost:3001` in `src/`.
- Tests: Vitest + React Testing Library (`npm run test`). New components should get a
  test that renders them and asserts on user-visible behavior, not implementation
  details. API calls are mocked with MSW (`src/test/`), using handlers built only from
  `@satisfactory-dash/shared/fixtures`. Override a route per test with `server.use(...)`.
- Fixtures never reach production code: `oxlint` rejects any import of
  `@satisfactory-dash/shared/fixtures` outside `src/test/` and `*.test.*` files.
- Deploy: Cloudflare Workers static assets (ADR-0013 amendment), configured by
  `wrangler.jsonc`. Cloudflare's Git build runs `npx wrangler`; it's not a dependency.
  Served on the custom domain only (`workers_dev` and `preview_urls` are off).
- Security headers (CSP, HSTS, etc.) live in `public/_headers` and apply in production
  only. A new external origin (API, font, image) must be added to the CSP there. Never
  add long-cache or `immutable` headers for `/assets/*` while `not_found_handling` is
  `single-page-application`: a missing hashed asset returns 200 `index.html`, and that
  HTML would be cached for a year.

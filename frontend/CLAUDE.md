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

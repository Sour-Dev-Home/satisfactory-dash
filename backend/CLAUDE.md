# backend/

See the root `CLAUDE.md` for project-wide rules, especially ground rules 2–5 (cite
docs-vault, prefer fixed chains over agents, don't build the mod first, isolate the
adapter). This module is the Express + TypeScript API server.

## Ownership boundary

Three sub-boundaries inside this module, intended to map onto separate future agents:

- `src/adapters/` — all Satisfactory-server communication (vanilla HTTPS API, FRM).
  The only place allowed to know FRM/vanilla-API response shapes. See its README.
- `src/services/` — business logic (production math, overflow/outage detection).
  Consumes adapters, never talks to a game server directly. See its README.
- `src/routes/` — HTTP/WebSocket surface exposed to `frontend/`. Translates
  `services/` output into the shapes defined in `@satisfactory-dash/shared`.

`src/server.ts` only wires these together — it should stay thin. The middleware
pipeline itself (request id, pino request logging, routes, the error envelope) is
`src/app.ts`'s `createApp()`, which has no side effects so route tests build exactly
what production runs.

## Conventions

- Build: `esbuild` bundles `src/server.ts` into a single self-contained
  `dist/server.cjs` (no `node_modules` needed at runtime — verified by running it in
  isolation). This is what the `Dockerfile` ships.
- Tests: Vitest + Supertest (`npm run test`). Route tests should hit the Express `app`
  export directly (see `server.test.ts`), not a running process. Service tests should
  use fixture data shaped like adapter output — no live game server required.
- `NODE_ENV=test` (set automatically by Vitest) disables `app.listen` so tests don't
  bind a real port.

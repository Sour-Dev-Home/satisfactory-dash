# backend/

See the root `CLAUDE.md` for project-wide rules, especially ground rules 2–5 (cite
docs-vault, prefer fixed chains over agents, don't build the mod first, isolate the
adapter). This module is the Express + TypeScript API server.

## Ownership boundary

A modular monolith (ADR-0014): the source is split by domain into `platform/` plus
`modules/`, and layers (adapters -> services -> routes) exist inside a module.

- `src/platform/` — cross-cutting HTTP and ops: logger, request context, client IP,
  the error taxonomy (`errors.ts`) and envelope, `httpPolicy.ts`. Imports no module.
- `src/modules/gameserver/` — a thin facade over `packages/game-adapter` (all communication
  with ONE Satisfactory server: vanilla HTTPS API, FRM; the only place allowed to know their
  response shapes; no Express, so the edge agent can lift it), plus the backend-only config
  loaders. Only this module and `platform/errors.ts` import the package. See both READMEs.
- `src/modules/servers/` — the registry of servers and `:serverId` scoping (ADR-0001).
- `src/modules/telemetry/` — status, factory and power: services (production math,
  overflow/outage detection) and the routes that expose them. See its README.
- `src/modules/identity/` — login, sessions and the session guard (ADR-0011).
- `src/modules/settings/` — the auto-pause toggle (ADR-0012), the dashboard's only write
  to a game server. Reads and writes only through gameserver's `ServerOptionsPort`.

Modules import one another only through `index.ts`, and only along the edges listed in
`src/architecture.test.ts`, which enforces the dependency rules; a new edge is a design
change, so ask the architect. `src/server.ts` is the composition root (with
`src/app.ts`): it builds the modules and wires the per-server bundle, and should stay
thin. The middleware pipeline itself (request id, pino request logging, routes, the
error envelope) is `src/app.ts`'s `createApp()`, which has no side effects so route
tests build exactly what production runs.

## Conventions

- Build: `esbuild` bundles `src/server.ts` into a single self-contained
  `dist/server.cjs` (no `node_modules` needed at runtime — verified by running it in
  isolation). This is what the `Dockerfile` ships.
- Tests: Vitest + Supertest (`npm run test`). Route tests should hit the Express `app`
  export directly (see `server.test.ts`), not a running process. Service tests should
  use fixture data shaped like adapter output — no live game server required.
- `NODE_ENV=test` (set automatically by Vitest) disables `app.listen` so tests don't
  bind a real port.

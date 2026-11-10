# backend/

See the root `CLAUDE.md` for project-wide rules, especially ground rules 2–5. This module
is the Express + TypeScript API server. It never calls a game server: game data arrives
only as the mod's `/agent/v1` pushes (`src/modules/agents/`, ADR-0066).

## Ownership boundary

A modular monolith (ADR-0014): the source is split by domain into `platform/` plus
`modules/`, and layers (adapters -> services -> routes) exist inside a module.

- `src/platform/` — cross-cutting HTTP and ops: logger, request context, client IP,
  the error taxonomy (`errors.ts`) and envelope, `httpPolicy.ts`. Imports no module.
- `src/modules/agents/` — the mod's `/agent/v1` protocol: pairing and enrolment,
  credentials, snapshot ingest and commands.
- `src/modules/servers/` — the registry of servers and `:serverId` scoping (ADR-0001).
- `src/modules/telemetry/` — status, factory and power: services (production math,
  overflow/outage detection) and the routes that expose them. See its README.
- `src/modules/identity/` — login, sessions and the session guard (ADR-0011).
- `src/modules/settings/` — the auto-pause toggle (ADR-0012), the dashboard's only write
  to a game server: a command queued for the mod (ADR-0066 Decision 4).

Modules import one another only through `index.ts`, and only along the edges listed in
`src/architecture.test.ts`, which enforces the dependency rules; a new edge is a design
change, so ask the architect. `src/server.ts` is the composition root (with
`src/app.ts`): it builds the modules and wires the per-server bundle, and should stay
thin. The middleware pipeline itself (request id, pino request logging, routes, the
error envelope) is `src/app.ts`'s `createApp()`, which has no side effects so route
tests build exactly what production runs.

## Conventions

- Migrations in `migrations/*.sql` are expand-only (ADR-0049 D6): a drop, rename, retype, `SET NOT NULL`, new `CHECK` on existing rows or `NOT NULL` column without a default needs a `-- contract: <why it is safe now>` line in the file, or `npm run migration-check` (in CI `verify`) fails.
- Build: `esbuild` bundles `src/server.ts` into a single self-contained
  `dist/server.cjs` (no `node_modules` needed at runtime — verified by running it in
  isolation). This is what the `Dockerfile` ships.
- `*.db.test.ts` run locally too, against a Testcontainers Postgres: run them with `npm run test:db`
  (Docker Desktop must be running) BEFORE pushing; never rely on CI for a first run. See
  `docs-vault/wiki/runbooks/database.md`.
- Tests: Vitest + Supertest (`npm run test`). Route tests should hit the Express `app`
  export directly (see `server.test.ts`), not a running process. Service tests should
  use domain-shaped fixture data (`telemetry/domain.ts`, `test-support/`) — no live game
  server required.
- `NODE_ENV=test` (set automatically by Vitest) disables `app.listen` so tests don't
  bind a real port.

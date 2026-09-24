# Architecture decisions

One file per decision (ADR), numbered in order. Each has a status, the context that
forced it, the decision, its consequences, and a "Revisit when" trigger that says what
would make it worth reopening. Decided 2026-09-22 by the architecture session under
the project owner's delegation (ADR-0001 to 0010) or with their approval (ADR-0011 to 0015). Change
a decision by adding a new ADR that supersedes it, not by rewriting history here.

| ADR | Decision |
|---|---|
| [0001](./0001-server-scoped-routes.md) | Server-scoped routes (`/api/servers/:serverId/...`) from day one |
| [0002](./0002-zod-contract.md) | Zod schemas in `packages/shared` are the single contract source |
| [0003](./0003-error-envelope.md) | One error envelope `{ error: { code, message, requestId, detail? } }` |
| [0004](./0004-snapshot-envelope.md) | Snapshot envelope `{ serverId, observedAt, stale, data }` on every data response |
| [0005](./0005-frontend-polls.md) | The frontend polls; push is deferred |
| [0006](./0006-units-and-semantics.md) | The backend normalizes units; every field's unit/range is documented in the schema |
| [0007](./0007-no-url-versioning.md) | No URL versioning; expand -> migrate -> contract once a consumer exists |
| [0008](./0008-structured-logging.md) | Structured logging with pino, now |
| [0009](./0009-no-database-yet.md) | No database yet; Postgres with visible SQL when a feature needs one |
| [0010](./0010-request-through.md) | Request-through; no cache or poller yet |
| [0011](./0011-login-required.md) | Login required on every `/api` route except health (single operator now) |
| [0012](./0012-auto-pause-toggle.md) | Auto-pause off by default, with a user toggle; paused state is visible |
| [0013](./0013-deployment-topology.md) | Deployment v1: frontend on Cloudflare Workers static assets (was Pages; amended 2026-09-23), backend on the game-server PC behind a Cloudflare Tunnel |
| [0014](./0014-target-architecture.md) | Target architecture: modular monolith now, service-based with an edge agent later |
| [0015](./0015-item-form-catalog.md) | Item form (solid vs fluid) from a generated catalog of the game's own data; additive `ProductionRate.unit` |

## Terms used in the ADRs

- **"captures" / "capture 00-paused", "F-panel", "CJ", "H", "01-running"**: the
  2026-09-22 live captures in `../../raw-sources/captured-responses/`, named
  `*-2026-09-22-<scenario>*.json`. Each file's header describes its scenario and what
  the in-game UI showed.
- **B1-B3**: mapping bugs found by those captures, not yet fixed as of 2026-09-22:
  - B1: `isBackedUp` (`backend/src/services/productionService.ts`) requires
    `isProducing`, but a machine with a full output stops producing, so it never fires.
  - B2: an unconfigured machine's `Recipe: "Unassigned"` is passed through as a real
    recipe, with a fake "Unassigned" production entry.
  - B3: a building's `circuitId` is mapped from `PowerInfo.CircuitID`, but `getPower`
    is keyed by `CircuitGroupID`; the two differ when a power switch is involved.
  A suspected fourth (refineries exposing no output inventory) was disproved; see
  `../frm-api.md`.
- **PR 1, 1b, 2a, 2b, 3, 4, 5, 6**: the planned rollout, in order of dependency:
  - PR 1: contract schemas in `packages/shared` (additive; old interfaces kept).
  - PR 1b: contract schemas for auth and settings endpoints.
  - PR 2a: pino logging, request ids, error middleware, validated responses
    (ADR-0003, 0008).
  - PR 2b: server-scoped routes, snapshot envelope, and the field renames (ADR-0001,
    0004, 0006).
  - PR 3: runtime validation of raw FRM/vanilla responses in the adapters, and TLS
    verification on by default except for loopback/private hosts.
  - PR 4: frontend foundation (API client, mocks from fixtures, polling, stale/error UI).
    This is the first real consumer of the contract.
  - PR 5: login (ADR-0011).
  - PR 6: auto-pause toggle (ADR-0012).
  B1-B3 are fixed in a separate bug-fix PR alongside PR 1.

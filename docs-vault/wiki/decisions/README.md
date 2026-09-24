# Architecture decisions

One file per decision (ADR), numbered in order. Each has a status, the context that
forced it, the decision, its consequences, and a "Revisit when" trigger that says what
would make it worth reopening. Decided 2026-09-22 by the architecture session under
the project owner's delegation (ADR-0001 to 0010) or with their approval (ADR-0011 to 0024). Change
a decision by adding a new ADR that supersedes it, not by rewriting history here.
The diagrams these decisions produce live in [`../architecture/`](../architecture/README.md).

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
| [0016](./0016-frontend-ui-architecture.md) | Frontend UI: Tailwind v4 tokens + shadcn/ui, React Router app shell, Playwright screenshots + axe, a read-only ui-reviewer; strict CSP kept |
| [0017](./0017-credential-lifecycle.md) | Credential lifecycle: game-server secrets never leave the game host; the cloud holds only a hashed per-server agent credential; managed servers use a secrets store |
| [0018](./0018-license-agpl.md) | License: AGPL-3.0-only, relicensed from MIT; earlier versions stay MIT; the owner is named in `LICENSE` only |
| [0019](./0019-api-security-posture.md) | API security posture at go-live (headers, 8 h sessions with a logout denylist, Origin check on writes, secret strength, edge rate limit) and what changes when it scales |
| [0020](./0020-multi-user-data-model.md) | Multi-user accounts (Google OIDC, Postgres sessions), server onboarding and roles, the data model, sync vs async, and a 5,000-user scale envelope; nothing built until its trigger |
| [0021](./0021-advertising.md) | Advertising: none on the dashboard or any authenticated page; ads only on separate public content pages if ever wanted; `/app/*` reserved for the app |
| [0022](./0022-power-history.md) | Live power history: the backend's first background poller (5 s) feeding an in-memory 5-minute ring buffer, and the additive `power/history` contract |
| [0023](./0023-live-map.md) | Live factory map: optional building `location` and `circuitGroupId` in the contract, Leaflet with CRS.Simple, a swappable base-map config, and a map-layer plug-in contract |
| [0024](./0024-architecture-as-code.md) | Architecture as code: one Structurizr model (`docs-vault/workspace.dsl`) that is AI-authored, CI-validated and drift-checked against the backend's module imports |
| [0025](./0025-postgres-and-google-sign-in.md) | **Accepted:** Postgres, Google sign-in and the DB registry, the ADR-0020 phase 1 build plan; hand-written parameterized SQL through `pg` (no query builder) |
| [0026](./0026-demo-mode.md) | **Accepted:** demo mode, a public offline demo (demo.satis-manager.com) that can never reach the real API; the frontend builds it from its own curated world |
| [0027](./0027-history-and-alerts.md) | **Proposed, not approved:** production history and alerts (Discord first); builds only after ADR-0025 gate A, since everything in it needs Postgres |

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

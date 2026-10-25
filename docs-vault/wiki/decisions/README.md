# Architecture decisions

One file per decision (ADR), numbered in order. Each has a status, the context that
forced it, the decision, its consequences, and a "Revisit when" trigger that says what
would make it worth reopening. Decided 2026-09-22 by the architecture session under
the project owner's delegation (ADR-0001 to 0010) or with their approval (ADR-0011 to 0024). Change
a decision by adding a new ADR that supersedes it, not by rewriting history here.
The diagrams these decisions produce live in [`../architecture/`](../architecture/README.md).
What changed and when is in [`../log.md`](../log.md) (frozen at 2026-09-25) and the per-PR fragments in
[`../log.d/`](../log.d/README.md) (ADR-0033).

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
| [0027](./0027-history-and-alerts.md) | **Accepted:** production history and alerts (Discord first); builds only after ADR-0025 gate A, since everything in it needs Postgres |
| [0028](./0028-uptime-monitoring.md) | **Accepted:** external uptime monitoring and a public status page (Better Stack, an ops@ alias), in place at ADR-0025 gate A; the monitor and the status page depend on `/api/health` and `/api/health/ready`, which stay detail-free |
| [0029](./0029-connected-players.md) | **Accepted:** showing who is connected: a members-only players route with the minimum data (`name`, `online`; no location, HP, inventory or "dead" marker), names never logged, and a privacy-outline row for third-party player names |
| [0030](./0030-multiple-servers.md) | **Accepted:** managing multiple servers in two phases: the operator adds, edits and removes local servers (loopback or private LAN only, every resolved address checked and the IP pinned, tokens AES-256-GCM encrypted in the database with a key from `SERVER_SECRETS_KEY`); players' own servers come later through the edge agent (ADR-0031), never by our backend holding their credentials or connecting to their hosts |
| [0031](./0031-edge-agent.md) | **Accepted:** the edge agent: the game PC connects out to the backend (enrollment code, per-server credential, snapshot push, commands by long-poll), so the backend never reaches into a player's network and can move to AWS; "agent offline" is a default alert preset |
| [0032](./0032-latency-and-ux-budgets.md) | **Accepted:** latency and UX budgets: measure server time (`Server-Timing`, `npm run latency-report`), turn "feel" into failing Playwright tests (no staged pop-in on a tab switch, CLS, INP, slow-network behaviour, a bundle budget), show data age, and a public scheduled probe of `/api/health/ready`; five steps, smallest first, no API latency targets until a week of baseline exists |
| [0033](./0033-delivery-workflow.md) | **Superseded by ADR-0043** (the log fragments stay): the delivery workflow: per-PR log fragments (`log.d/`, `log.md` frozen) that end the conflict loops, a merge queue with a fresh-eyes gate that carries the reviewed status onto the queue's commit, and one task board |
| [0034](./0034-backend-on-aws.md) | **Accepted:** the backend and database move to AWS, time-boxed on the account's credits, with portability requirements (no AWS SDK in the app path, environment-only configuration, JSON logs to stdout), an exit trigger and a rehearsed exit (Oracle Cloud Always Free is the named target) |
| [0035](./0035-backups-off-aws.md) | **Accepted:** nightly encrypted backups move off AWS to Backblaze B2 (Object Lock, upload-only key), so backups do not depend on the AWS account that closes with the credits; the privacy page says up to 37 days |
| [0036](./0036-metrics-page.md) | **Accepted:** an operator-only metrics page: one `GET /api/admin/metrics` with a shared schema whose sections are available or not, latency from the backend's own histogram rollups in Postgres (not log files), delivery and CI computed in GitHub Actions and pushed to a hashed-secret ingest endpoint (the backend holds no GitHub token), alert quality first from `alert_events`, uptime as a status-page link; built after the agent parity week, tracked in #281 |
| [0037](./0037-performance-metrics-and-load-testing.md) | **Accepted:** system metrics and a load-testing kit (#331): a fixed metric registry with bounded labels, stored in one general Postgres table `metrics.series_hourly` (amends ADR-0036 step 3), no OpenTelemetry until a second service exists, and a k6 load kit with a seed script that refuses production, run on the local stack and once on AWS before cut-over, with reports committed to `wiki/perf/`; no real-user Web Vitals for now |
| [0038](./0038-map-base-and-overlays.md) | **Accepted:** the map's base image and overlay layers (#330): a data-derived base map now (no Coffee Stain image without written permission, which the owner requests in parallel), two data tiers (live: trains, vehicles, drones at 30 s; world: rails, nodes, markers, belts at 10 min or 30 min for game-thread reads, sent only when the data changed, hashed and capped), latest-only storage with ETag-served GETs, layers fetched only when toggled on, and no player positions (ADR-0029 stays) |
| [0039](./0039-mod-as-end-state-research.md) | **Accepted:** a game mod as the end-state data source, explored behind evidence gates (#332): our own SML mod that would post the existing agent-input contract, needed only for rented game servers that cannot run the agent; gates G0 (capture the sources), G1 (a claims table), G2 (spikes on the real server, spike code in a separate repository); no build (G3) without the owner's explicit go, and the agent stays the supported path; no mod-API statement counts as fact without a captured source |
| [0040](./0040-server-manager-holdover.md) | **Accepted:** the server manager (#436), a small Electron app for the owner's PC only, as a holdover until the mod: it starts the game server as a supervised child process, stops it with `SaveGame` then `Shutdown` before any kill, updates it through SteamCMD, backs off after 3 crash restarts in 10 minutes, and watches the agent, which stays a Scheduled Task; no installer, no port, no token shown or logged, settings under `%LOCALAPPDATA%` |
| [0041](./0041-ficsit-industrial-direction.md) | **Accepted:** the FICSIT-industrial visual direction (#441), replacing ADR-0016's direction B2: steel-grey surfaces, warm ink, FICSIT amber as the accent and power (never a status), red only for failure and blue only for "paused"; self-hosted Barlow for text and Barlow Condensed for uppercase headings, labels and tabs; a decorative hazard stripe and panel rivets; station icons like the case-study figures; motion only where it means something, off under reduced motion |
| [0042](./0042-build-the-mod.md) | **Proposed:** build the mod (ADR-0039 G3, #473), option C as the core mod v1 in the approved spec (`satisfactory-dash-mod` at `14fae53`): another agent on the `/agent/v1` contract, so the backend doesn't change; six sub-projects (G3 prep, core mod v1, FRM bridge, distribution, switchover and the Node agent's deprecation, native readers); spikes C8 and C9 before any build code, 30-minute parity before v1 is done, and the Node agent stays the supported path until the switchover; the licence and hosts risks (#471, #472) reopen it before distribution if blocking |
| [0043](./0043-retire-lanes.md) | **Accepted:** lanes retired (owner, 2026-10-20): no merge queue, no required reviews, PRs squash auto-merge once `verify`, `e2e` and `security` pass; the reviewer subagents stay and the session runs them before the PR; supersedes ADR-0033 except its log fragments |
| [0044](./0044-web-push-alert-channel.md) | **Accepted:** web push as a second alert channel (owner, 2026-10-20, #348): per-user opt-in per server through the existing outbox and worker, subscription endpoint and keys sealed, a configurable push-service host allowlist, VAPID keys from the environment; Apple's push address and the payload caps stay [NEEDS VERIFICATION]. |
| [0045](./0045-threat-model-untrusted-servers.md) | **Proposed:** threat model for game servers the owner doesn't control (#505): one table per trust boundary (mod to backend, tunnel and edge, browser to backend, operator tooling) plus retention of other players' data, each risk an existing control, a new task or an explicit accept; #514 (per-credential ingest budgets), #515 (per-server quotas) and #516 (operator abuse response) gate the mod's first public release, #517 (self-serve agent servers) waits for the owner's sign-up decision |
| [0046](./0046-self-serve-agent-servers.md) | **Proposed:** self-serve agent servers with per-account caps (#517), a gate on the mod's first public release: a signed-in player creates an `agent` server (no connection test, backend-generated id, owner in the same transaction), within caps per account and in total that the operator alone sets by configuration; 60-bit enrolment codes so the global enrol limit can rise; open sign-up and self-serve ship dark behind `SIGNUP_MODE` and `SELF_SERVE_ENABLED`; revisits ADR-0045 M2, M3 and B5; build tasks #523 to #530 |
| [0047](./0047-account-deletion-and-leaving.md) | **Accepted:** account deletion and leaving a server (#311 tasks 2 and 3): delete the user row (the cascades remove identities, sessions, memberships and push data), keep audit rows naming its random id for their normal year, soft-delete owned self-serve servers through the same purge, refuse with a list while operator servers are owned, a sign-in within 10 minutes to delete, and new codes `would_orphan` and `reauth_required` |
| [0048](./0048-bottleneck-finder.md) | **Accepted (amended 2026-10-21: belt level on FRM connections; visible after the pipe and rebuild checks):** bottleneck finder (#349): belt-level root cause is a no-go on FRM data (no connection identities, port positions, splitters or mergers); an item-level finder over the existing factory snapshot is a go: a machine/item graph walked upstream or downstream to ranked verdicts (`noProducer`, `deficit`, `upstream`, `logistics`), no new reads or snapshot bytes; four build tasks, follow-ups for extractors, buffer fill and a mod connection claim. **Amendment 2026-10-21 (proposed):** FRM 1.5.4 now names both ends of every belt, lift and pipe, so the belt level is a go without the mod: a `conveyors` world layer (10 min, sent on hash change), Dinic min-cut per consumer and ingredient naming the capping conveyor, new `notConnected` verdict and `cappedBy` field, five PRs hidden until the Factory page section ships; G-checks for rebuild staleness and the pipe `Speed` unit |
| [0049](./0049-automated-staged-deploys.md) | **Accepted (owner, 2026-10-21; prod deploys automatic once staging passes):** automated, staged backend deploys: GitHub Actions assumes two least-privilege roles through OIDC (bound to `deploy.yml` on `main` and a GitHub environment; no AWS key), Terraform owns the task-definition base and CI only swaps the image (`ignore_changes` on the service, the release record in SSM); staging is a throwaway task on its own cluster, tunnel and in-task PostgreSQL (not a second RDS database: roles are per instance), with smoke checks and a short Playwright run; the same digests then go to production after the owner's approval, with migrate first, alarm and circuit-breaker rollback, a one-click rollback and a Discord notice; expand-only migrations enforced in `verify`; under $0.50 a month; six build PRs |
| [0050](./0050-production-planner.md) | **Accepted (owner, 2026-10-21):** production planner (#588): a new `production-graph` endpoint coarsens the bottleneck finder's connection graph (extracted into a shared `connectionGraph.ts`) into machine groups per recipe and manifold, infers each edge's item from recipes and gives measured, estimated or unknown rates by flow balance; no new game-server read; dagre (MIT, 17 KB gzip, no eval) lays out one site at a time in a lazy chunk, with tables as the text form; sites are weakly connected components merged by distance, player names later and anchored by position; graph algorithms worth building (coarsening, flow balance, WCC, SCC, reachability, Sugiyama) and deferred ones (dominators, LP); train links gated on a 1.5.4 capture, drones and trucks unverified; six build PRs |
| [0051](./0051-public-release-plan.md) | **Proposed:** public release plan: device-code pairing (the mod prints a 60-bit code, the player enters it at `/pair`; six setup actions plus an invite become five, no file edit), no FRM dependency until the FRM bridge ships and the owner clears FRM's licence and Coffee Stain's terms (legal blockers, not decided), eight ordered milestones ending in a capped public beta after the AWS exit, Oracle Cloud Always Free after AWS with Hetzner CAX11 as the paid fallback, and still no email |

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

# Log

Append-only record of ingests, queries, and maintenance operations. Newest entries at
the bottom.

- 2026-09-21 — project scaffolded, docs-vault created, no sources ingested yet.
- 2026-09-21 — Ingested all three priority sources from `raw-sources/README.md`:
  `frm-read-api.md` and `frm-dedicated-server.md` fetched from docs.ficsit.app;
  `dedicated-server-api.md` copied from the local Steam install's
  `CommunityResources/DedicatedServerAPIDocs.md` (found at
  `Steam/steamapps/common/Satisfactory/CommunityResources/` — ships with the regular
  game client, not just a standalone dedicated-server install, so no local dedicated
  server needed to be installed for this step). Wrote two wiki summary pages
  (`vanilla-dedicated-server-api.md`, `frm-api.md`) and updated `index.md`.
  Open items flagged `[NEEDS VERIFICATION]` in `frm-api.md`: individual FRM endpoint
  schema pages (`getFactory`, `getPower`, `getPowerUsage`, etc.) were not captured —
  only the index page was — so exact field names for production rate, overflow, and
  power data are still unknown. `data-gap-analysis.md` was intentionally left
  unfilled; it requires live requests against a running server per its own header,
  which is the Phase 2 spike, not this step.
- 2026-09-21 — Captured three more sources ahead of the spike: SML's official
  "Installing Mods on Dedicated Servers" and "Manual Installation" docs
  (`sml-dedicated-server-setup.md`, `sml-manual-install.md`), and FRM's current
  config reference (`frm-config.md`, which revealed FRM's built-in `DiscIT` webhook
  system with power-outage/battery-threshold notifications — relevant to ground rule
  3). Also captured field-level schema pages for the five FRM endpoints most relevant
  to this project's stated metrics: `frm-getFactory.md`, `frm-getPower.md`,
  `frm-getPowerUsage.md`, `frm-getPlayer.md`, `frm-getSessionInfo.md`, plus
  `frm-getBelts.md` (checked specifically to answer the overflow-detection question —
  confirmed belts carry no fullness/backup data). Updated `frm-api.md` with per-metric
  coverage notes grounded in these schemas.
- 2026-09-21 — Ran the Phase 2 spike: installed a local dedicated server via SteamCMD
  (a separate install directory outside this repo, GameVersion 1.2.4.0 / CL 502094,
  ~15.4GB, anonymous login, app 1690800), manually installed SML 3.12.0 and FRM 1.5.3
  (WindowsServer targets, fetched
  via the ficsit.app GraphQL API since ficsit-cli's mod-install flow is
  interactive-TUI-only and not scriptable headlessly), and started the server with
  `FG.DedicatedServer.AllowInsecureLocalAccess=1` for local testing. Created a fresh
  session via the vanilla API's `CreateNewGame`, then hit both APIs with curl. Findings
  written up in `vanilla-dedicated-server-api.md`, `frm-api.md`, and
  `data-gap-analysis.md`; raw captured responses and discrepancy notes saved under
  `raw-sources/captured-responses/`. Headline results: every stated metric (production
  rate, overflow via a proxy, power outage, player data, server health) is covered by
  the two existing APIs — no custom mod needed. Real response field casing is
  camelCase, not the docs' PascalCase; `CreateNewGame` needed an undocumented
  `GameModeSettings` field; FRM's *tunneled* Game Port transport 404'd (use FRM's
  direct Web Server instead, and note it needs `uWS.Autostart=1` set explicitly, it's
  not on by default). Could not validate `getFactory`/`getPower`/`getPowerUsage`
  against real non-empty data since the test save has no buildings or connected
  players — that would need a human playing on the server, out of scope here. The
  server was shut down after the spike; to bring it back up: run
  `FactoryServer.exe -log
  -ini:Engine:[SystemSettings]:FG.DedicatedServer.AllowInsecureLocalAccess=1` from the
  install directory, it will
  auto-load the `docs-vault-spike` session.
- 2026-09-21 — Added `lessons-learned.md` after an independent `test-hunter` review of
  `backend/src/adapters/` found two real bugs (both unwrapped runtime exceptions
  leaking past a client's typed-error contract on a malformed 2xx response — see that
  page for details). Reported to the implementer session for a fix; a confirmation
  `test-hunter` pass will follow once fixed.
- 2026-09-21 — Confirmation pass complete: the implementer's fixes for both bugs in
  `lessons-learned.md` verified correct by a second, independent `test-hunter` (targeted
  fixes, no collateral changes to adjacent behavior — primitive-body resolution, 204
  handling, non-ok-status wording, and network-error wording all confirmed unchanged).
  5 new precise tests added pinning exact error messages/fields, not just error type.
  No new bug pattern found, so no `lessons-learned.md` counters changed. Full suite
  37/37 passing, typecheck and lint clean.
- 2026-09-21 — Independent `test-hunter` review of `backend/src/services/` and
  `backend/src/routes/` (built on top of `adapters/` on branch
  `feature/backend-services-routes`). No business-logic bugs found in the
  production/overflow/power-outage threshold math — tried to break it with
  zero/negative/boundary inputs, all held or were already covered by the implementer's
  own tests. Closed one real gap: added a test in `server.test.ts` exercising the real
  service→router wiring against a genuine (not synthetic) adapter failure, confirming
  all three business routes return a clean 503 rather than hanging or crashing.
  Pushed to branch `review/backend-services-routes` for the implementer to merge.
  Added one new `lessons-learned.md` entry (`backend/src/routes/`, `String(err)`
  losing `AggregateError` detail) — minor debuggability gap, not a crash, flagged but
  not fixed.
- 2026-09-21 — Implementer fixed the `AggregateError` detail bug with a shared
  `formatErrorDetail.ts` helper used by all three routes, merged the confirmation
  worktree's wiring test, and fixed the finding without being asked twice. A second
  independent `test-hunter` confirmed the fix: correct and general (verified against a
  plain `Error`, single- and multi-error `AggregateError`, zero-error `AggregateError`,
  and non-`Error` thrown values), no regression to `/api/factory`/`/api/power`, and
  confirmed against the real Node runtime's actual `AggregateError` shape (not a mock).
  Found one real but currently-unreachable gap in the fix itself: the unwrap doesn't
  recurse into a *nested* `AggregateError`, so incremented the existing
  `lessons-learned.md` routes entry to `(×2)` instead of adding a new line, since it's
  the same underlying pattern recurring one level deeper in the fix meant to close it.
  Documented with a failing test on branch `confirm/services-routes-fix`, not fixed
  (non-blocking). Full suite 84/85 (with that one intentional failing test included),
  typecheck/lint/build all clean.
- 2026-09-21 — Implementer applied the one-line recursive fix
  (`err.errors.map((cause) => formatErrorDetail(cause))`) and pushed to
  `feature/backend-services-routes` at `03956a3`. A third, narrow independent
  `test-hunter` confirmation verified it's genuinely recursive (not a one-level special
  case) via 3-4 level nesting and a 500-level synthetic chain, no regression on any
  previously-verified case, and a sanity check that the only stack-overflow path
  requires a deliberately-constructed circular reference unreachable from any real
  Node API. **PASS — this closes the `backend/src/routes/` lessons-learned entry's
  `(×2)` finding.** 94/94 tests, typecheck/lint clean. This closes out both rounds of
  the `backend/src/services/` + `backend/src/routes/` review; all findings from this
  slice are now fixed and confirmed.
- 2026-09-22 — Live captures from a populated tier-6 save (338 buildings, player
  connected, readings compared against the in-game UI) added to
  `raw-sources/captured-responses/*-2026-09-22-*`: five `getPower`, two `getFactory`
  trimmed to the buildings that demonstrate each finding, and two `QueryServerState`
  with the session name replaced by a placeholder. `frm-api.md`,
  `vanilla-dedicated-server-api.md` and `data-gap-analysis.md` now record the verified
  units and semantics (MW/MWh, per-minute rates including clock speed, 0-100 percents,
  circuit groups, battery fields, pause state, `TotalGameDuration` as cumulative play
  time). Found three mapping bugs (backed-up rule never fires, "Unassigned" treated as a
  recipe, building circuit keyed by `CircuitID` instead of `CircuitGroupID`), not yet
  fixed. A fourth suspected blind spot (refineries exposing no output inventory) turned
  out wrong: `OutputInventory` just omits empty slots. Added the `GetServerOptions`
  allowlist rule to `backend/src/adapters/README.md`, since its output contains FRM's
  auth token in plaintext.
- 2026-09-22 — Added `decisions/` with ADR-0001 to 0012, written by the architecture
  session (0001-0010 under the project owner's delegation, 0011-0012 approved by them) and
  reviewed against the code first: the review changed ADR-0003 (the error classifier's
  tests are updated, not dropped), ADR-0007 (expand/contract only once a deployed
  consumer exists), ADR-0012 (no duplicate `gamePaused`/`playerCount` fields; "editable"
  requires a verified Administrator token), and removed a suspected refinery blind spot
  after the captures disproved it. Every line citation in the ADRs was checked against
  the files on `main`.
- 2026-09-23 — ADR-0003 amended: error codes `not_found` (404), `payload_too_large`
  (413) and `unsupported_media_type` (415), keeping one status per code. Prompted by a
  fresh-eyes review of the error middleware.
- 2026-09-23 — Added ADR-0013 (deployment topology v1, accepted by the project owner):
  frontend on Cloudflare Pages at satis-manager.com, backend on the game-server PC
  published through a Cloudflare Tunnel at api.satis-manager.com, no port forwarding.
  The tunnel stays off until PR 2b, 3 and 5 are merged, the FRM token is rotated and a
  security review is done.
- 2026-09-23 — Amended ADR-0013: the frontend is served by Cloudflare Workers static
  assets instead of Pages (the account's Git deploy offers Workers only). Added
  `frontend/wrangler.jsonc`; domain and cookie model unchanged.
- 2026-09-23 — ADR-0011 clarified (issue #19): which routes need no session, the
  session check never returns 401, and the JSON-only rule applies only to requests
  with a body.
- 2026-09-23 — ADR-0003: a wrong HTTP method answers 404 `not_found`, never 405.
  ADR-0011: recorded the stateless-session trade-off, and that the login rate limit
  trusts CF-Connecting-IP only from a loopback peer, with the backend on 127.0.0.1.
- 2026-09-23 — Retired the `fresh-eyes-review` CI job (its API credit ran out; no paid
  variant). Fresh-eyes review is now a fresh `test-hunter` subagent in the developer
  session, run on draft PRs that change real logic before `gh pr ready` (root
  `CLAUDE.md`, `../WORKFLOW.md`). The `ANTHROPIC_API_KEY` repo secret is now unused.
- 2026-09-23 — ADR-0014 added (accepted by the project owner): target architecture is a
  modular monolith now, then service-based with an edge agent. Step 1 is the backend
  domain partition, guarded by an architecture test.
- 2026-09-23 — ADR-0017 added (accepted by the project owner): the credential lifecycle.
  Game-server secrets (FRM token, vanilla application token, admin password) never leave
  the game host; the cloud holds only a hashed per-server agent credential; managed
  servers keep their secrets in a secrets store. Nothing is built yet; the triggers are in
  the ADR.
- 2026-09-23 — Added `runbooks/go-live-api.md` and `scripts/windows/` (register and
  unregister a Scheduled Task for the backend): the ordered go-live steps for issue #19.
- 2026-09-23 — ADR-0018 added (accepted by the project owner): the repo is relicensed from
  MIT to AGPL-3.0-only. `LICENSE` holds the AGPL text and names the copyright holder (the
  one exception to the no-personal-names rule; CI excludes only that file). Versions up to
  the last MIT commit stay MIT. `CONTRIBUTING.md` says outside contributions wait for a
  CLA or DCO.
- 2026-09-23 — ADR-0015 added (accepted by the project owner): a solid/fluid item catalog
  generated from the game's own `CommunityResources` data, and an additive
  `ProductionRate.unit`. Resolves the Polymer Resin question in `frm-api.md` and ADR-0006:
  it is solid, items/min.
- 2026-09-23 — ADR-0012 built (PR 6): `modules/settings` and gameserver's allowlisted
  `ServerOptionsPort`. Live check recorded in the ADR: DSAutoPause applies immediately.
- 2026-09-24 — Added ADR-0016 (frontend UI architecture, accepted by the project owner):
  Tailwind v4 design tokens and shadcn/ui, a React Router app shell, Playwright screenshot
  and axe checks with a read-only ui-reviewer, and a strict CSP where any
  `securitypolicyviolation` fails a test (item 8). Build order: this docs step, then
  tooling with no visual change, then a chosen design direction, then the foundation, then
  one restyled view per PR.
- 2026-09-24 — Go-live runbook sections 2 and 3 run against an auth-enforcing server: game
  API 403 without a token, 200 with it; backend login, status, settings and the auto-pause
  flip/restore all passed (recorded in ADR-0012). FRM: read endpoints are open by design,
  write endpoints enforce `X-FRM-Authorization` (401 without or with a wrong token, 200 with
  the right one), which settles the header-name question. FRM token rotated (old token now
  401). Runbook section 2 corrected: there may be no launcher file to edit.
- 2026-09-24 — Added ADR-0019 (API security posture, accepted by the architect under the
  owner's delegation) after a read-only security review of the exposed surface: response
  headers, 8 h sessions with a logout denylist, Origin check on writes, SESSION_SECRET
  strength, a Cloudflare login rate-limit rule, and the table of what changes at scale.
  Implemented in the same change; runbook section 5 gains the rate-limit step and the
  emergency revoke-all.
- 2026-09-24 — Backfilled two `lessons-learned.md` entries from the first
  `security-reviewer` pass on `backend/src/adapters/` (2026-09-22) that never landed on
  `main`: the commit adding them was pushed to a since-deleted branch
  (`worktree-lessons-learned`) but never entered a PR, so it was orphaned when PR #5
  merged an earlier commit on that branch. Confirmed the gap with
  `git merge-base --is-ancestor` against `origin/main`. Both findings — unvalidated
  upstream responses and the non-host-scoped self-signed-cert default — are already
  fixed by PR #17, so backfilled marked `Fixed in #17` rather than as open findings.
- 2026-09-24 — Added ADR-0020 (multi-user accounts, server onboarding and data model,
  accepted by the project owner): Google-only OIDC sign-up, Postgres server-side sessions,
  users-to-servers many-to-many with owner/admin/viewer roles, atomically consumed
  enrollment codes, last-write-wins `latest_snapshots`, async ingest/SSE/commands, and a
  5,000-user envelope with viewer-driven agent cadence. Docs only: nothing is built until
  its triggers fire (the first account beyond the owner).
- 2026-09-24 — Added ADR-0021 (advertising, accepted by the project owner): no ads on any
  authenticated page and no ad scripts in the SPA; if ads are ever wanted, only on separate
  static public pages with their own CSP and a certified CMP; `/app/*` is reserved for the
  authenticated app so `/` and public paths stay free. Docs only.
- 2026-09-24 — Added ADR-0022 (live power history, accepted by the project owner; issue
  #74): the backend's first background poller samples getPower every 5 s into an
  in-memory 5-minute ring buffer per server behind a source-agnostic store interface, with
  a reset rule on session change or a game-time rewind and an additive
  `GET /api/servers/:serverId/power/history` contract. No database yet. Build order: this
  docs step, then the shared contract, then the backend poller, store and route.
- 2026-09-24 — ADR-0022 built on the backend (steps 2-3): the shared power-history contract
  (#80) and the telemetry module's `PowerHistoryStore` (an in-memory ring buffer, 60 points
  per circuit), a `PowerHistoryPoller` (the backend's first background worker: one poll at a
  time, nominal 5 s ticks, failures leave gaps and are logged on state change only, reset on
  a session change or a game-clock rewind), a `PowerHistoryService` (stale = last success
  older than 3 intervals) and `GET /api/servers/:serverId/power/history`, served from memory.
  `server.ts` starts the workers once the server is listening and stops them on
  SIGINT/SIGTERM. The producer guarantees the ordering, paused-range and cap rules the schema
  does not enforce, and a route test proves them over fake time with gaps, a pause and resets.
- 2026-09-24 — Request-timeout hardening (architect follow-up to ADR-0022): the backend now
  refuses to start unless `SATISFACTORY_REQUEST_TIMEOUT_MS` is unset or a whole number from
  1000 to 60000 (a non-numeric value used to become NaN, which made every FRM call fail as
  "unreachable"), and the vanilla API transport has an overall per-request deadline
  (`AbortSignal.timeout`, like FRM) on top of its idle-socket timeout, so a game server that
  trickles bytes forever ends as a 503 `upstream_unreachable` instead of holding a request open.
- 2026-09-24 — Follow-up to that (architect ruling): a lost auto-pause write response is read
  back once (idempotent option), answering 200 with an audit line "outcome confirmed by
  re-read" when the value landed, else the 503 stands (ADR-0012 note); and
  `SATISFACTORY_API_PORT` / `FRM_WEB_PORT` must be whole numbers from 1 to 65535, otherwise the
  backend refuses to start (they used to become NaN).
- 2026-09-24 — Architecture diagrams added to `docs-vault/wiki/architecture/` (four D2 sources
  and rendered SVGs, README with the ADRs each reflects and the D2 v0.9.0 render command),
  linked from `decisions/README.md` and the wiki index. Rule going forward: a PR that changes
  what a diagram shows (topology, module edges) updates the `.d2` and re-renders in the same PR.
  Same PR: ADR-0023 (live factory map) committed as `decisions/0023-live-map.md`, accepted by
  the owner 2026-09-24; its coordinate unit (centimetres) stays [NEEDS VERIFICATION] until an
  in-game distance check.
- 2026-09-24 — ADR-0023 step 2 (shared contract): `FactoryBuilding` gains optional
  `location { xM, yM, zM, rotationDeg }` (rotation in [0, 360)) and optional `circuitGroupId`
  (-1 = unconnected). Both optional per the deploy-skew rule. Fixtures carry real coordinates from
  the 2026-09-22 capture, converted to metres. The centimetres assumption stays
  [NEEDS VERIFICATION] pending the owner's in-game distance check. The backend fills the fields in
  the next PR (step 3).
- 2026-09-24 — ADR-0023 step 3 (backend): the game-server adapter maps FRM's building `location`
  from centimetres to metres (a documented assumption, still [NEEDS VERIFICATION] pending the
  owner's in-game distance check) and normalizes the yaw to [0, 360); the factory overview now
  sends `location` and `circuitGroupId` per building. Also: `PORT` is validated like the game
  server ports (a whole number 1-65535, else the backend refuses to start), and a stale
  `VerifyAuthenticationToken` comment in the options adapter was corrected.
- 2026-09-24 — ADR-0023 amendment (units and world bounds): new source note
  `raw-sources/world-coordinates.md` (SCIM's map bounds, numbers only, and a community answer,
  both approximate) corroborates that FRM locations are centimetres, +x east, +y south, in a
  7,500 m square world; ADR-0023 now carries `worldBoundsM { minX -3246.99, maxX 4253.02,
  minY -3750, maxY 3750 }` and the Leaflet mapping `[lat, lng] = [-yM, xM]`. The in-game check is
  now a confirmation, not a blocker. The units note in the shared `location` description and the
  adapter comment cite the source (comments only; no schema or behaviour change).
- 2026-09-24 — ADR-0024 (architecture as code) committed as `decisions/0024-architecture-as-code.md`,
  accepted by the owner. The Structurizr model lives at `docs-vault/workspace.dsl` (the docs-vault
  root, because `!adrs` only accepts a subdirectory of the DSL file's folder); it is the source of
  truth and the D2 diagrams are presentation-only. Phase 3 (dependency-cruiser drift check) and
  phase 4 (`!adrs`/`!docs`) follow later.
- 2026-09-24 — ADR-0024 phase 3: `npm run architecture:check` (scripts/architecture-drift.mjs)
  runs dependency-cruiser over the backend production sources, collapses file imports to
  component edges (`modules/<name>`, `platform`, `root` = app.ts and server.ts) and compares
  them with the Backend API component relationships in `docs-vault/workspace.dsl`; an unknown or
  missing edge fails. It found one gap on its first run: the model had no `root -> platform`
  edge although app.ts and server.ts import platform/ (added, tagged platform-use, hidden from
  the readable view). `npm run test:scripts` covers the script. Not yet wired into CI.
- 2026-09-24 — ADR-0024 phase 3 wired into CI: the Architecture job now installs the repo and runs
  `npm run architecture:check` as a REPORT-ONLY step (a finding warns, never fails the job); its
  report ships in the diagrams artifact as `architecture-out/drift-report.txt`. The job's path
  filter also triggers on `backend/src/platform/`, `app.ts`, `server.ts` and the drift script. It
  becomes a required check after about a week of green runs on main.
- 2026-09-24 — ADR-0025 (Postgres, Google sign-in and the DB registry: the ADR-0020 phase 1 build
  plan) added as `decisions/0025-postgres-and-google-sign-in.md`, status PROPOSED by the
  architect. Nothing in it is approved to build; it awaits the owner's decisions listed at its end.
- 2026-09-24 — ADR-0025 PR 1 (multiple servers from config): `SATISFACTORY_SERVERS_FILE` names a
  git-ignored JSON file with any number of servers (id, name, host, ports, tokens), validated at
  startup with the same rules as the single-server env (reused, not copied); each entry gets its
  own connection, telemetry bundle and power-history poller. Without the variable the
  single-server env works exactly as before. `backend/servers.example.json` (placeholders) and a
  runbook section document the format.
- 2026-09-24 — ADR-0025 accepted by the owner except decision 7 (query layer, still open): status
  line, the owner's answers, the AWS backup steps as owner-performed and a new PR row 8b (backup
  script and runbook) added. PRs 1-2 may start; PR 3 onward waits on decision 7.
- 2026-09-24 — ADR-0025 decision 7 answered by the owner: hand-written parameterized SQL through
  `pg`, every row set parsed by zod, no query builder (Decision 2 rewritten with the guardrails).
  ADR-0025 is now fully accepted; PR 3 onward is unblocked.
- 2026-09-24 — ADR-0025 PR 2 (database foundation, no query layer): `platform/db` (pg pool, the
  DATABASE_URL config, startup error classification with backoff, schema-version check,
  withTransaction, central pg error helpers), `/api/health/ready` (`SELECT 1`, 1 s timeout, no
  detail; its schema joins the contract in PR 4), node-pg-migrate `.sql` migrations with the
  satis_migrator/satis_app roles and the builtin C.UTF-8 locale (`npm run db:init`,
  `npm run db:migrate`), a Testcontainers Postgres 18 harness that fails (never skips) in CI when
  Docker is missing, a guard against SQL built from input, and `runbooks/database.md`. Optional:
  without DATABASE_URL the backend behaves exactly as before.
- 2026-09-25 — ADR-0025 PR 3 (schema and repositories, no wiring yet): migration
  `1790294400000_core_tables` creates `identity.users`, `auth_identities`, `login_attempts`
  (relative /app return paths only, enforced by a CHECK), `sessions` (only sha256 of the id),
  `servers.servers`, `servers.server_members` (a partial unique index allows one owner per server)
  and the append-only `audit.audit_events` (satis_app can insert and read, never update or
  delete). Hand-written, parameterized SQL repositories with zod-parsed rows: identity
  (users/identities, sessions, login attempts with a single-use guarded DELETE), servers
  (registry, per-user list, membership lookups scoped by user, atomic ownership transfer) and
  `platform/audit`. Nothing calls them yet: sessions (PR 5) and authorization (PR 6) come next.
  The real-Postgres tests cover every constraint and the concurrency cases. The login return
  path is an ASCII-only allowlist (RFC 3986 characters) written once in
  `identity/returnPath.ts` and used verbatim by the CHECK constraint and the zod schema; a test
  asserts they agree.
- 2026-09-25 — ADR-0026 (demo mode: a public, offline demo at demo.satis-manager.com that can
  never reach the real API) added as `decisions/0026-demo-mode.md`, accepted by the owner. The
  frontend builds it from its own curated world under `frontend/src/demo`; `packages/shared`
  fixtures are not changed for it.
- 2026-09-25 — Log rotation with a 14-day retention (privacy policy): with `LOG_DIR` set the backend
  writes JSON logs to one file per UTC day (`backend-YYYY-MM-DD.log`) and deletes its own files
  dated more than 13 days before today, at start and at every rotation (so a long outage cannot
  leave old logs behind). It is a small synchronous, dependency-free stream instead of pino-roll:
  pino transports run in a worker thread that the esbuild single-file bundle cannot carry, and an
  async stream can lose the fatal line written just before `process.exit(1)`. Unset, logs go to
  stdout as before; an unusable `LOG_DIR` stops the backend at startup. Runbook updated.
- 2026-09-25 — ADR-0025 PR 4 (contract, additive): `KnownErrorCode` gains `forbidden` (403, a
  member whose role doesn't allow the action; a non-member still gets `server_not_found`) and
  `service_unavailable` (503; a session lookup failing because the database is down is this,
  never a 401). New `ReadinessResponseSchema` (`ok` | `unavailable`) and the `healthReady`
  endpoint (`GET /api/health/ready`); the backend's readiness route now parses its body with it.
  `SessionResponse.user` gains optional `email` and `authMethods` (a plain string array, so a
  method added later doesn't break an older frontend), and the `auth.logoutAll` endpoint
  (`POST /api/auth/logout-all`, answers like logout) is declared: the backend serves it in PR 5.
  Callers updated on both sides: the backend status map, `ForbiddenError` and
  `ServiceUnavailableError`, and the frontend's error-kind map.
- 2026-09-25 — ADR-0027 (production history and alerts, Discord first) added as
  `decisions/0027-history-and-alerts.md`, status PROPOSED by the architect: nothing in it is
  approved to build, and it builds only after ADR-0025 gate A (everything in it needs Postgres).
  Its Context references were checked against the code (power.ts, factory.ts, frm-api.md,
  rawSchemas.ts) and match.
- 2026-09-25 — ADR-0027 accepted by the owner (all seven owner decisions as recommended, relayed
  by the coordinator 2026-09-24): status, an "Owner decisions (answered)" section and the README
  row updated. It still builds only after ADR-0025 gate A.
- 2026-09-25 — Privacy policy and terms outline added as `legal/privacy-terms-outline.md` (the
  architect's draft, verbatim): an outline with [OWNER]/[LEGAL]/[BUILD] markers, not the published
  policy and not legal advice; it contains no personal data (the controller identity is an owner
  decision). Roadmap 2b: it must be live before ADR-0025 gate B. Its [BUILD] prerequisites for the
  backend are log rotation with 14-day retention, user ids instead of usernames in sign-in logs
  after PR 5, a purge job for expired sessions and stale login attempts, and account deletion
  before member invites.
- 2026-09-25 — Privacy/terms outline updated with the owner's answers (relayed by the coordinator):
  the contact mailbox is privacy@, retention is decided (audit events 1 year, logs 14 days), and the
  published pages will be `frontend/public/privacy.html` and `terms.html`. The owner is named only
  on the published page, never in the repo docs.
- 2026-09-25 — ADR-0028 (external uptime monitoring and a public status page) added as
  `decisions/0028-uptime-monitoring.md`, accepted by the owner: Better Stack, a public status
  page and the ops@ alias; in place at ADR-0025 gate A. Rule for the backend: `/api/health` and
  `/api/health/ready` stay detail-free forever, since an external monitor and a public status
  page depend on them.
- 2026-09-25 — ADR-0025 PR 5 (database sessions): a `SessionStore` interface with a stateless store
  (the original signed tokens, used without a database) and a database store (`identity.sessions`,
  hashed 32-byte ids, DB clock, touch at most once a minute, audit rows of ids only). A database
  outage is a 503 (`service_unavailable`), never a 401; an old or foreign cookie is refused without
  a query and cleared. The operator has a fixed identity (`local`/`operator`), so renaming the
  `.env` user never forks an account. `POST /api/auth/logout-all` is served, sign-in logs carry the
  user id, a purge worker keeps retention (sessions 30 days after expiry, stale login attempts;
  hourly, batched) and `npm run admin -- revoke-sessions` is the audited break-glass.
- 2026-09-25 — Log levels: one rule (`platform/logLevel.ts`) for both the request line and the
  failure line, so error tracking and log-based alerting see only real failures: 5xx (or an error
  with a non-error status) is `error`, a 401 ("Sign in to continue", routine while signed out) is
  `info`, 429 and every other 4xx is `warn`, the rest `info`. Before, every classified failure
  was logged at level 50, including 401s.
- 2026-09-25 — ADR-0025 PR 6 (server authorization): with a database, one middleware
  (`createAuthorizeServer`, mounted by the servers router on `/servers/:serverId`) looks up the
  signed-in user's membership. A non-member gets the same 404 `server_not_found` as an unknown
  server (existence is not revealed), a viewer's write (any method but GET/HEAD/OPTIONS) is 403
  `forbidden`, and the role is set on `res.locals.serverRole`. Because it is one mount, a new
  server-scoped route cannot skip it, and the IDOR tests (`serverAuthorization.test.ts`) are
  generated from the shared `endpoints` list. `GET /api/servers` is per user (their servers that
  this process can also reach). At startup, once the database is up, the configured servers are
  upserted with the operator as owner (a no-op after ownership moves), and scoped routes answer
  503 until then; `/api/health/ready` includes it. A database outage is a 503, never a 404.
  Without `DATABASE_URL` nothing changes. `resolveServer` and its six call sites are untouched.
- 2026-09-25 — Gate A security review, L1 and L2. L1: every membership change writes its audit row
  in the same statement (a data-modifying CTE) or transaction (ownership transfer):
  `member_added`, `member_role_changed`, `member_removed`, `ownership_transferred`, with ids and
  roles only; the startup bootstrap-owner grant is audited once with no actor and a restart adds
  nothing; a refused change (duplicate, second owner, owner role change) leaves no row. L2: login
  ends the session named by the browser's incoming cookie in the same transaction that creates the
  new one ("rotated on login"), so a copied old cookie does not survive a re-login; only the
  presented session ends, and an unknown, malformed or already-ended cookie is ignored. The
  stateless store ignores it (removed in PR 9).
- 2026-09-25 — Docs: ADR-0025 re-copied from the architect's draft (adds "Considered and rejected:
  Supabase Auth") and ADR-0026 (the in-house demo router replaced the msw `getResponse` path,
  #113), both verbatim. The database runbook's log-hygiene sentence is corrected after the gate A
  security review (L3): the pool and startup paths log codes only, but the request error handler
  logs the cause chain, so a database outage line includes the driver's message (never the
  password or URL, never in a response body).
- 2026-09-25 — Follow-ups to the L1/L2 change, from the architect's review: `setMemberRole` no
  longer writes an audit row when the role does not change (`AND role <> new` in the UPDATE) and
  returns `changed` / `unchanged` / `not_found`; the login audit row carries `rotated: true` when
  a live session really ended. The database runbook gains "Windows port reservations" (Postgres
  could not bind 5432 because the TCP dynamic port range started at 1024 and Hyper-V reserved
  5358-5457; fix: reset the dynamic range to 49152/16384 and, optionally, an administered
  exclusion for 5432).
- 2026-09-25 — ADR-0029 (showing who is connected, minimal data) copied verbatim from the
  architect's draft and marked accepted (owner, relayed by reactapps-dc, 2026-09-24): README row
  and index entry. The overview cards brief (Players, Tick rate, Health) is added as
  `architecture/overview-cards.md`. The database runbook gains a "Gate B checklist: Google
  sign-in" section, including the bootstrap-trust note (a verified email equal to
  `BOOTSTRAP_OWNER_EMAIL`, no hosted-domain check, so the address must be one only the owner
  controls, with 2-step verification).
- 2026-09-25 — ADR-0025 PR 7: Google sign-in (backend only; deploys at gate B, and with the
  GOOGLE_* settings unset it is off and `/api/auth/google/*` answers 404). `GET
  /api/auth/google/start` creates an `identity.login_attempts` row (state, nonce, PKCE verifier,
  validated return path) and redirects to Google with an S256 challenge; the browser holds only
  the random attempt id in a Lax, path-scoped cookie. `GET /api/auth/google/callback` consumes
  the attempt once, exchanges the code (openid-client v6, lazy cached discovery, a Google outage
  is a 503 on `/start` only), requires `email_verified === true`, finds the account by
  `(google, sub)` and never by email, and in ONE transaction starts the session (rotating the
  presented one) and writes the audit row. The one email lookup is the one-time bootstrap link to
  the seeded operator; any other account is refused (no user row, no email stored, audit
  `signin.refused`). Every redirect is the configured frontend origin plus a stored path or a
  fixed error code (`denied`, `expired`, `failed`, `not_invited`, `unavailable`). New settings:
  GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI, BOOTSTRAP_OWNER_EMAIL,
  FRONTEND_ORIGIN (all-or-nothing, validated at startup). The per-IP request cap was extracted
  from the password route so both share it.
- 2026-09-25 — ADR-0025 PR 7 review follow-ups: the request log no longer records the Google
  callback's query (its one-time code and state); the bootstrap link writes an `identity_link`
  audit row (ids and codes only); note for the runbook: the bootstrap trust rests on the verified
  email equalling `BOOTSTRAP_OWNER_EMAIL` with no hosted-domain check, so use an address whose
  mailbox you alone control (a consumer address, not one on a domain others administer).
- 2026-09-25 — ADR-0027 PR 1, the machine-states contract (additive, all optional): `FactoryBuilding.ingredients` (what a machine consumes, the same shape and unit resolution as `production`, now sent by the backend from FRM's parsed ingredients), `FactoryBuilding.state` (a plain string with the known values in its description: producing, idle, backedUp, starved, paused, unpowered; a string rather than an enum so a later state does not break a deployed frontend) and `Factory.stateCounts`. The backend does not send `state` or `stateCounts` yet: that is the derivation in PR 2.
- 2026-09-25 — The privacy and terms outline is re-copied from the architect's location-neutral draft (it no longer names a state: "a US-based operator"; the state-specific notes are kept private). A repo-wide search for the old wording found no other hit. Git history keeps the earlier text.
- 2026-09-25 — `SessionResponse.signInMethods` (additive, optional string array) tells a signed-out login screen which methods to offer: `["password"]`, or `["password", "google"]` when Google sign-in is configured; `endpoints.auth.googleStart` names the redirect path (no response schema). Distinct from `authMethods`, which is what an account has linked.
- 2026-09-25 — ADR-0029, who is connected (contract, adapter and route in ONE PR: the generated IDOR tests refuse a contract without its authorized route, the intended safety property). `GET /api/servers/:serverId/players` answers `{ available, players: { name, online }[] }`, members of the server only. Minimization at the boundary: the raw FRM schema declares only `Name` and `Online`, so ID, location, HP, speed, "dead" and inventory are dropped before the domain (the domain `Player` is now `{ name, online }`, and a player with only those two fields is valid). `available: false` when FRM is absent, unreachable or refuses; a response FRM sent that fails validation stays a 502. Live only: nothing is stored, and there is no status cache to match (players are fetched per request, bounded by client polling). Never logged: pino redact paths for `players` (three nesting levels) plus tests that capture the trace-level log output of success, FRM-absent and invalid-response requests and assert no name, id, position or inventory appears. The privacy-outline row is a separate docs PR.
- 2026-09-25 — Privacy outline re-copied from the architect's updated draft, which adds the row for the in-game names of players connected to a server the reader is a member of (ADR-0029: shown live to that server's members only, not stored and not logged, from the server owner's own game server).
- 2026-09-25 — ADR-0025 backup follow-up 2, the missed-backup heartbeat, part 1: `platform/backup/heartbeat.ts` (`loadHeartbeatUrl` for the optional `BACKUP_HEARTBEAT_URL`: https only, no embedded credentials, errors never echo the value; `pingHeartbeat`: GET with a 10 s timeout and no redirect following, best effort: it never throws, and only fixed descriptions are logged, never the URL, a status body or the error text). Unit-tested. Not wired yet: the call after a real upload in `scripts/backup.ts`, the `.env.example` line and the runbook section land as a one-change follow-up once the backup script (PR 8b) is on main.
- 2026-09-25 — Event loop monitor (diagnostic; architect request): prod showed machine-wide stalls (FRM connect ETIMEDOUT, database probe misses for 1-80 s). `platform/eventLoopMonitor.ts` measures the loop delay with `perf_hooks.monitorEventLoopDelay` (resolution 20 ms, whose values include that resolution) and, once per 30 s window, logs ONE warn `event_loop_stall` with `max_ms`, `p99_ms` and `mean_ms` (numbers only) when the window's worst delay exceeds `EVENT_LOOP_STALL_MS` (50-60000, default 500, validated at startup). The window is reset each time, so one stall is reported once. It is a worker started once the server listens, its timer is unref'd and stopped on shutdown, and it changes no response. Reading it: a stall with this line means our own loop was blocked (the file log stream writes synchronously, so a slow disk would show here); a stall without it means the process was not the one blocked (Windows stalled the machine or its scheduling).
- 2026-09-25 — Readiness probe hardening (prod `/api/health/ready` returned two self-healing 503s on the busy game PC; the likely cause is the 1 s budget covering a fresh TCP + SCRAM connection after the pool closed its idle ones every 30 s). The pool now keeps one connection (`min: 1`, not pre-created); the readiness budget is 3 s and configurable (`DATABASE_READINESS_TIMEOUT_MS`, 100-10000); the probe borrows a connection and times the two phases apart, and a miss logs ONE warn with a fixed code (`readiness_probe_slow` or `readiness_probe_failed`), `elapsed_ms`, `phase` and, for errors, only the database error code, never a message. The public response is unchanged (`{"status":"unavailable"}`). A probe that finishes after its deadline still returns its connection to the pool, and a failed one destroys it.
- 2026-09-25 — ADR-0025 PR 8b: the database backup. `npm run backup -w backend` (`platform/backup/backup.ts`, all external programs behind an injected runner and unit-tested without Postgres, age or AWS): `pg_dump --format=custom --no-owner` (grants kept), `age` encryption to a PUBLIC recipient, the plaintext deleted immediately on success and failure, upload with the put-only `satis-backup` AWS profile under `satis-dash/`, the newest N encrypted copies kept locally (S3 retention is the bucket lifecycle rule). The password travels only in PGPASSWORD; every failure exits non-zero with a message that names the step and never a secret. New `runbooks/backups.md`: the owner's one-time AWS and age setup, a local trial without AWS, and the restore rehearsal. Not exercised against a real Postgres in this session (Docker and Postgres are off by design): the first real run is the owner's local trial. The scheduled task is registered by the coordinator; the privacy.html edit pairs with the frontend privacy-page PR (the page is not on main yet).
- 2026-09-25 — Backups: the optional missed-backup heartbeat is wired (`BACKUP_HEARTBEAT_URL`: https only, no embedded credentials, validated before the backup runs; one GET with a 10 s timeout and no redirect following, only after a really uploaded backup; a failed ping is logged with a fixed description and never fails the backup; the URL is never logged). The backups runbook gains the heartbeat section, the recommendation to use the read-only `satis_backup` role through `BACKUP_DATABASE_URL`, and the owner-decided "limited identity" exception (owner decision 2026-09-25): its absolute "no session creates AWS resources" sentence now allows the one-time bucket and budget setup through the time-boxed `satis-setup` identity, with its policy documented and marked "owner creates; delete the user after setup". ADR-0025 re-copied verbatim from the architect's draft with the decision 7 amendment.
- 2026-09-25 — ADR-0025 backup follow-up 1: `db:init` can create a read-only `satis_backup` role (optional `DB_BACKUP_PASSWORD`, 16+ characters and different from the others; unset touches nothing). It is a member of the predefined `pg_read_all_data` role (so a pg_dump is complete by construction, including future tables and sequences), read-only by default, with CONNECT on the database and no other rights; the backup uses it through `BACKUP_DATABASE_URL` and never borrows the app's or the migrator's credentials. Tested against real Postgres (CI): reads every table and the audit sequence, cannot insert, update, delete, truncate or run DDL, membership in nothing else, and re-running db:init keeps the grants. The backups runbook recommendation follows once that runbook is on main.
- 2026-09-25 — Event loop monitor (diagnostic; architect request): prod showed machine-wide stalls (FRM connect ETIMEDOUT, database probe misses for 1-80 s). `platform/eventLoopMonitor.ts` measures the loop delay with `perf_hooks.monitorEventLoopDelay` (resolution 20 ms, whose values include that resolution) and, once per 30 s window, logs ONE warn `event_loop_stall` with `max_ms`, `p99_ms` and `mean_ms` (numbers only) when the window's worst delay exceeds `EVENT_LOOP_STALL_MS` (50-60000, default 500, validated at startup). The window is reset each time, so one stall is reported once. It is a worker started once the server listens, its timer is unref'd and stopped on shutdown, and it changes no response. Reading it: a stall with this line means our own loop was blocked (the file log stream writes synchronously, so a slow disk would show here); a stall without it means the process was not the one blocked (Windows stalled the machine or its scheduling).
- 2026-09-25 — Readiness probe hardening (prod `/api/health/ready` returned two self-healing 503s on the busy game PC; the likely cause is the 1 s budget covering a fresh TCP + SCRAM connection after the pool closed its idle ones every 30 s). The pool now keeps one connection (`min: 1`, not pre-created); the readiness budget is 3 s and configurable (`DATABASE_READINESS_TIMEOUT_MS`, 100-10000); the probe borrows a connection and times the two phases apart, and a miss logs ONE warn with a fixed code (`readiness_probe_slow` or `readiness_probe_failed`), `elapsed_ms`, `phase` and, for errors, only the database error code, never a message. The public response is unchanged (`{"status":"unavailable"}`). A probe that finishes after its deadline still returns its connection to the pool, and a failed one destroys it.
- 2026-09-25 — ADR-0025 PR 8b: the database backup. `npm run backup -w backend` (`platform/backup/backup.ts`, all external programs behind an injected runner and unit-tested without Postgres, age or AWS): `pg_dump --format=custom --no-owner` (grants kept), `age` encryption to a PUBLIC recipient, the plaintext deleted immediately on success and failure, upload with the put-only `satis-backup` AWS profile under `satis-dash/`, the newest N encrypted copies kept locally (S3 retention is the bucket lifecycle rule). The password travels only in PGPASSWORD; every failure exits non-zero with a message that names the step and never a secret. New `runbooks/backups.md`: the owner's one-time AWS and age setup, a local trial without AWS, and the restore rehearsal. Not exercised against a real Postgres in this session (Docker and Postgres are off by design): the first real run is the owner's local trial. The scheduled task is registered by the coordinator; the privacy.html edit pairs with the frontend privacy-page PR (the page is not on main yet).
- 2026-09-25 — Audit retention (privacy policy: audit events are kept 1 year): migration `1790380800000_audit_purge` adds `audit.purge_expired_events()` (SECURITY DEFINER, owned by the migrator, `search_path = pg_catalog, audit`, everything schema-qualified, EXECUTE revoked from PUBLIC and granted to `satis_app` only). `satis_app` still cannot DELETE, UPDATE or TRUNCATE the append-only trail; the function deletes only events older than a year and returns the count. The identity purge worker calls it at startup and then at most once a day, logs the count and warns without detail on failure (it never affects the session purge or a request). Tested against real Postgres (CI): only older-than-a-year rows go, direct deletes stay refused, the function's properties, a hijack attempt through the caller's search_path, and no audit row from the purge itself. The privacy page's "Audit events: 1 year" sentence goes in with the frontend's privacy page (`frontend/public/privacy.html` is not on main yet).
- 2026-09-25 — Audit retention, architect additions (same migration): the purge leaves its own trace, one `audit.retention_purge` row with `{count}` only and no personal data, written by the function in the same statement and ONLY when it removed something (no daily noise rows); and "the app never sets `at`" is now a database guarantee: `satis_app` has column-level INSERT on `audit.audit_events` for `actor_user_id`, `server_id`, `action` and `detail` only, so an INSERT naming `at` (or `id`) is refused with 42501. That closes back-dated rows (purged early) and future-dated rows (never purged). Tested against real Postgres.
- 2026-09-25 — ADR-0027 PR 2, machine states: the factory response now carries each building's `state` (producing, idle, backedUp, starved, paused, unpowered) and `Factory.stateCounts`, derived per snapshot by `telemetry/services/classifyBuilding.ts` (pure, no window: FRM's `percent` is already an average, `isProducing` is never used alone) from the building itself, including its own `PowerInfo.FuseTriggered` (the CJ capture shows it true on the tripped grid, so no `getPower` call). A state is omitted, never guessed, when the data is missing (no fuse information for a connected machine, or no finite output percent), and such buildings are not counted. The starved threshold (5 percent) is PROVISIONAL, from 2 snapshots and 10 buildings; golden files pin the outcome for those 10, and `npm run capture-factory -w backend` (dev only, the owner's go-ahead) records a series to tune it before the alert engine (PR 5). ADR-0027 re-copied with the per-snapshot amendment; `wiki/machine-states.md` documents the rules and the evidence.
- 2026-09-25 — Shared fixtures for the players endpoint (ADR-0029), for the frontend's mock server: `playersAvailable` (three online and one offline, obviously fake names), `playersUnavailable` and `playersEmpty`, each matched to `ServerPlayersResponseSchema` by the fixtures drift test. Fixtures only.
- 2026-09-25 — Privacy outline re-copied from the architect's draft (the backups retention line is now "up to 37 days": the versioned bucket's 30-day expiry makes a noncurrent version that is deleted 7 days later). `runbooks/backups.md` says the same in its intro, the lifecycle step and the Privacy section.
- 2026-09-25 — Startup ordering (issue #153: on the Windows host the first one or two database connects of a new backend process time out and succeed on retry, so the startup purges logged "failed; will retry"): the identity purge worker (sessions, login attempts, audit events) is no longer started at boot with the other workers. The composition root starts it only AFTER the database startup check succeeded and the configured servers were registered, and the worker then waits `PURGE_START_DELAY_MS` more (0-600000, default 30000, validated at startup) before its first run. A real later failure still warns exactly as before. It is stopped on shutdown with the other workers.
- 2026-09-25 — The nightly backup retry wrapper is now in the repo as `scripts/windows/backup-task.ps1` (sanitized from the local copy: no absolute user paths; `-RepoDir` defaults to the repo holding the script, `-PostgresBin`/`-AgeDir`/`-AwsDir` follow the standard install locations, `-Attempts`, `-RetryMinutes`, `-Log`). `runbooks/backups.md` "Scheduling" now describes the `SatisfactoryDashBackup` task (daily 03:00, interactive user, StartWhenAvailable, RunOnlyIfNetworkAvailable, 3 h limit, IgnoreNew), gives the Register-ScheduledTask commands, and explains that Task Scheduler's restart setting only covers launch failures, which is why the wrapper retries. It also documents setting up `satis_backup` by hand (GRANT CONNECT on the database is required; an app-role dump fails on `pgmigrations_id_seq`).
- 2026-09-25 — Database runbook: a Windows section on Npcap (Wireshark). Its loopback WFP callout drops the first SYN-ACK on 127.0.0.1 and Node on Windows sends no loopback SYN retransmit, so first connects fail with ETIMEDOUT at about 310 ms (issue #153, fixed by putting the Npcap service on Manual start). Start it only for a capture session and stop it afterwards.
- 2026-09-25 — Gate B review Lows fixed. `res.headers.location` is now redacted globally in the request log (the Google sign-in redirect carries state, nonce and code_challenge; a future auth route cannot forget it). The Google sign-in routes are top-level navigations, so a failure never renders JSON at the API host: at `/start` a Google discovery outage or a database outage redirects to `FRONTEND_ORIGIN/app/login?error=unavailable` and any other failure to `error=failed` (the real cause logged as a fixed code, `google_start_unavailable` or `google_start_failed`, no message); over the per-IP cap both `/start` and `/callback` redirect to `error=unavailable` instead of answering 429. The 404 when Google is not configured is unchanged.
- 2026-09-25 — ADR-0030 (managing multiple servers) accepted by the owner and added verbatim as `decisions/0030-multiple-servers.md`: phase 1 is operator-managed local servers (loopback and private LAN only, every resolved address checked and the IP pinned, tokens AES-256-GCM encrypted in the DB, the servers file retired via an `import-servers` CLI); phase 2 is players' own servers through the edge agent (ADR-0031), with no third-party credential custody. The build plan is PRs 2-7 in the ADR; a combined security review runs before any deploy.
- 2026-09-25 — Backups proven end to end. The first real nightly run succeeded (dump, age encryption, S3 upload, heartbeat); the scheduled task runs daily at 03:00 through the retry wrapper. A restore rehearsal PASSED: the newest S3 object was decrypted with the offline age key and restored into a scratch database, and the counts matched live (users 1/1, servers 1/1, members 1/1, audit events 5/6: one event was newer than the dump). The newest migration in the restore was `1790380800000_audit_purge`. The scratch database was dropped and the plaintext deleted. The result is recorded in `runbooks/backups.md`; ADR-0025 8b is closed by the architect. ADR-0030 (multiple servers) was accepted the same day and is logged in its own entry.

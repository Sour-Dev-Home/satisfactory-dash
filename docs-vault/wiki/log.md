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

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

# Wiki index

Catalog of every page in this wiki. One line per page. Updated whenever a page is
added or removed.

- [`vanilla-dedicated-server-api.md`](./vanilla-dedicated-server-api.md) — **historical** (ADR-0066: nothing
  calls this API; kept for reference): summary of the official Dedicated Server API (Lightweight UDP Query + HTTPS JSON-RPC): auth,
  relevant functions, and the observation that it has no production/power data model.
- [`runbooks/owasp-top-10-check.md`](./runbooks/owasp-top-10-check.md) — the repeatable OWASP Top 10:2025 sanity
  check: per category, what to look at in this repo, the status (PASS/GAP), the follow-up issues, and a log of runs.
- [`runbooks/go-live-api.md`](./runbooks/go-live-api.md) — ordered steps to turn on the
  API: production `.env` (no game tokens since ADR-0066), a check through an enrolled mod, Scheduled Task, Cloudflare Tunnel, go-live
  tests and rollback (issue #19).
- [`runbooks/backups.md`](./runbooks/backups.md) — the nightly encrypted database backup (pg_dump, age,
  put-only S3 upload): the owner's one-time AWS and age setup, a local trial without AWS, and the
  restore rehearsal (ADR-0025 decision 7).
- [`runbooks/dev-remote.md`](./runbooks/dev-remote.md) — the optional remote dev box (`DEV_REMOTE_HOST`): `npm run remote-test` and
  `npm run baselines -- <worktree> --local`, what ships, and every fallback.
- [`runbooks/delivery-metrics.md`](./runbooks/delivery-metrics.md) — `npm run delivery-metrics` (#280): DORA-style
  aggregates from the GitHub API and the log fragments (throughput, lead time, change-failure
  proxies), the stable JSON shape, and the definitions and limits.
- [`log.md`](./log.md) and [`log.d/`](./log.d/README.md) — the wiki's change log: `log.md` is frozen at
  2026-09-25 and each PR since adds one fragment file in `log.d/` (ADR-0033); `npm run log` prints both in order.
- [`runbooks/servers.md`](./runbooks/servers.md) — servers since ADR-0066 (mod only: no stored connections, no
  `import-servers`): the managed list, rename and remove, the `SERVER_SECRETS_KEY` (webhooks, push) and its offline
  backup, key rotation and `verify-secrets` (which opens the webhooks and push data since ADR-0066 PR 10a).
- [`runbooks/history.md`](./runbooks/history.md) — production history (ADR-0027 PR 3): the deploy
  order (`db:migrate` first), what is stored and for how long, the recorder, the snapshot ingest and rollup worker.
- [`runbooks/alerts.md`](./runbooks/alerts.md) — the alert engine (ADR-0027 PR 5): the deploy order (`db:migrate`
  first), the rule kinds and presets, suppression, restarts, and the SQL to read the alert log during the shadow run.
- [`runbooks/agents.md`](./runbooks/agents.md) — the backend side of the edge agent, which since ADR-0066 is the mod
  only (ADR-0031 PR 5a and 5b): the deploy order (`db:migrate` first), enrolment codes, revoking (the only way back is
  re-enrolling), commands (auto-pause answers `202`), and the `agent_offline` alert.
- [`runbooks/abuse-response.md`](./runbooks/abuse-response.md) — the operator's abuse response (#516, ADR-0045): find a
  server, remove it so nothing is left (the table-by-table list), `disable-user` / `enable-user`, and what to re-apply
  after restoring a backup.
- [`runbooks/backend-cheat-sheet.md`](./runbooks/backend-cheat-sheet.md) — facts that cost CI rounds when guessed: the two
  server ids (public string vs internal UUID), which errors are `ApiFailure` and which are plain classes, the rate-limiter
  defaults that bite in tests, ordering rules in the servers module, running DB tests locally, the CI-wait one-liner, and
  the worktree git rules.
- [`runbooks/agent-app.md`](./runbooks/agent-app.md) — **retired** (ADR-0066): the Node edge agent is deleted; the page
  keeps a banner, the conform-don't-reject rule other code cites, and how to remove an old install.
- [`runbooks/aws.md`](./runbooks/aws.md) — the backend on AWS (ADR-0034, #405, #408, #409): running an ops task, apply,
  deploy and its health checks, migrate, restore, scale to 0, the monthly credit check, the backup-role check, the tunnel,
  the cutover and the exit.
- [`frm-api.md`](./frm-api.md) — **historical** (ADR-0066: nothing calls FRM; kept for reference and as the mod's
  parity record): summary of FicsitRemoteMonitoring's Read API: the two
  transports (Web Server vs. tunneled Game Port API), the full endpoint index grouped
  by resource, and which endpoints are candidates for production-rate/overflow/power
  monitoring (field-level schemas still need capturing — see `log.md`).
- [`frm-endpoint-volumes.md`](./frm-endpoint-volumes.md) — **historical** (ADR-0066): per FRM endpoint of the Players card and map-overlay work (#329,
  #330): measured size and item count from real captures (2026-09-27), whether it runs on the game thread, and whether the
  vanilla API or the agent's current snapshot already covers it; three responses are large (schematics, resource nodes,
  train rails, about 1.4 MB together).
- [`mod-claims.md`](./mod-claims.md) — ADR-0039 gate G1: the claims table ("the mod can ...", C1 to C7) with the source of
  each claim in `raw-sources/`, the spike that would test it, and its status (all `unverified`); the facts found by gate G0
  (Unreal Engine 5.6.1, licences, no reachable Coffee Stain terms), the owner's licence choice for the mod repository
  (GPL-3.0-or-later) and the open questions.
- [`mod-maintenance.md`](./mod-maintenance.md) — ADR-0039 G3 prep (#472): each game patch from 1.0 to 1.2.4.0 against
  SML's releases (which needed a new SML, and the gap in days), and five rented hosts' mod docs (custom mods allowed,
  outbound network stated).
- [`machine-states.md`](./machine-states.md) — how a machine's state (producing, idle, backed up,
  underfed, paused, unpowered) is derived per snapshot (ADR-0027), the provisional threshold and its
  evidence, and how to tune it with a capture session.
- [`data-gap-analysis.md`](./data-gap-analysis.md) — the player-facing metrics the mod sends (per ADR-0058 reader)
  and the gaps it does not yet send (Linux hosts, storage, drones and trucks, fluid overflow); the mod is the only
  source since ADR-0066, and the FRM path's power-production note is kept as history.
- [`lessons-learned.md`](./lessons-learned.md) — one-sentence-per-bug log of real bugs
  found by independent `test-hunter` review passes, with a counter that increments
  when the same pattern recurs, so repeated mistakes get visible sooner.
- [`frontend-wiring-checklist.md`](./frontend-wiring-checklist.md) — every file to change, in order, when the
  frontend gains an endpoint or a screen: the query or write hook, secrets kept out of caches, the three mocks
  (unit, e2e/dev:mock, demo), e2e states and baselines, checks and tier (#289).
- [`frontend-planner-map.md`](./frontend-planner-map.md) — how the Planner canvas (ADR-0050: hierarchy, scene,
  lazy dagre chunk, memoized `layoutScene`, token-only SVG), the operator's metrics page (ADR-0056) and the Map
  (ADR-0023: Leaflet chunk, projection, `MapLayer` world layers) are built, with their CSP and bundle gates; moved out
  of `frontend/CLAUDE.md`.
- [`roadmap.md`](./roadmap.md) — where the product stands and what "a successful product" means as
  checkable targets (time to dashboard, alert speed and quality, adoption, security, release safety), approved
  by the owner on 2026-09-25 (ADR-0033).
- [`decisions/`](./decisions/README.md) — architecture decision records (ADR-0001 onward,
  from 2026-09-22): contract, errors, units, versioning, logging, storage, caching,
  login, the auto-pause toggle, deployment, target architecture, the item-form catalog,
  frontend UI architecture and the license. The README table lists every ADR (ADR-0025,
  Postgres and Google sign-in, is accepted; ADR-0026, the offline demo mode, is accepted; ADR-0027, production history and alerts, is
  accepted, and builds only after ADR-0025 gate A; ADR-0028, external uptime monitoring and a
  public status page, is accepted; ADR-0029, showing who is connected with minimal data, is accepted; ADR-0030, managing multiple servers, is accepted; [ADR-0040](./decisions/0040-server-manager-holdover.md),
  the server manager, an Electron holdover until the mod, is superseded by ADR-0066).
- [`decisions/0045-threat-model-untrusted-servers.md`](./decisions/0045-threat-model-untrusted-servers.md) — the threat
  model for game servers the owner doesn't control (#505, proposed): per trust boundary, each risk with an existing
  control, a new task (#514 to #517) or an explicit accept; gates the mod's first public release.
- [`decisions/0046-self-serve-agent-servers.md`](./decisions/0046-self-serve-agent-servers.md) — self-serve agent
  servers with per-account caps (#517, proposed): how a signed-in player creates a server without the operator, the
  caps and who raises them, abuse response, the privacy-page changes, and build tasks #523 to #530.
- [`decisions/0047-account-deletion-and-leaving.md`](./decisions/0047-account-deletion-and-leaving.md) — account
  deletion and leaving a server (#311, accepted): delete rather than anonymise, audit rows kept for their year, what
  happens to owned servers, recent sign-in to delete, and the two new error codes.
- [`decisions/0048-bottleneck-finder.md`](./decisions/0048-bottleneck-finder.md) — bottleneck finder (#349,
  accepted; waits for belt data): why belt-level root cause is a no-go on FRM data, the item-level graph walk that is
  a go, its contract sketch and build tasks, and what the mod would need for belt level.
- [`decisions/0049-automated-staged-deploys.md`](./decisions/0049-automated-staged-deploys.md) — automated, staged
  backend deploys (accepted 2026-10-21; prod automatic after staging): GitHub OIDC deploy roles with exact IAM actions, Terraform owns config and CI owns the
  image, a throwaway staging task with its own PostgreSQL and tunnel, an automatic promotion of the same digests once staging passes,
  alarm rollback, expand/contract migrations, cost and build tasks.
- [`decisions/0050-production-planner.md`](./decisions/0050-production-planner.md) — production planner (#588,
  accepted 2026-10-21): the backend coarsens the finder's connection graph into machine groups with inferred items and measured or
  estimated rates, dagre lays out one site at a time in a lazy chunk, sites are computed from connected components
  merged by distance, which graph algorithms are worth building, train links gated on a capture, build tasks.
- [`decisions/0051-public-release-plan.md`](./decisions/0051-public-release-plan.md) — public release plan (accepted
  2026-10-24): device-code pairing, FRM as a dependency (blocked on legal clearance), the ordered milestones to a
  public beta, hosting after the AWS Free plan, and no email.
- [`decisions/0063-planner-ports-end-labels-dimming.md`](./decisions/0063-planner-ports-end-labels-dimming.md) — planner
  item ports, end labels and dimming (accepted 2026-11-01, five open questions): one item port per card side, one line
  per item, a name-and-rate label at each end with the middle bubble as the fallback, dimming by colour over a pure focus
  set, nothing new focusable, seven build PRs behind `planner.ports`.
- [`decisions/0064-skimmable-pages.md`](./decisions/0064-skimmable-pages.md) — skimmable pages (accepted 2026-11-03):
  normal is quiet, one fact in one place, no empty boxes, details fold; Factory, Overview and Power cuts and the folded
  machine table, five build PRs.
- [`architecture/`](./architecture/README.md) — D2 architecture diagrams (context, deployed
  containers, backend modules, target) with rendered SVGs and re-render instructions, and the
  [overview cards brief](./architecture/overview-cards.md) (Players, Tick rate, Health).
- [`legal/privacy-terms-outline.md`](./legal/privacy-terms-outline.md) — an outline (not the
  published policy, not legal advice) for the privacy policy and terms, with `[OWNER]`, `[LEGAL]`
  and `[BUILD]` markers; roadmap 2b, needed before ADR-0025 gate B.
- [`ad-network-comparison.md`](./ad-network-comparison.md) — ADR-0021 amendment build step 1: EthicalAds and Carbon Ads
  (with AdSense and Venatus as contrasts) on acceptance, cookies, iframe and login rules, payout and CSP hosts, each cell
  cited to a `raw-sources/ad-network-*` capture; recommends EthicalAds, with acceptance (50k pageviews, developer sites)
  as the main risk.
- [`../raw-sources/adsense-csp-and-cmp-2026-11-01.md`](../raw-sources/adsense-csp-and-cmp-2026-11-01.md) — ADR-0021
  amendment 2 build step 1: Google's pages on AdSense and CSP (strict nonce CSP only, no domain list), the Privacy &
  messaging CMP (certified, deployed by the AdSense tag, revocation call, US state message), limited ads, the crawler
  login and placement limits, as verbatim excerpts E1-E18.
- [`../raw-sources/cloudflare-workers-assets-worker-2026-11-01.md`](../raw-sources/cloudflare-workers-assets-worker-2026-11-01.md)
  — ADR-0021 amendment 3 build step 2: Cloudflare's pages on a Worker in front of static assets (`run_worker_first`
  patterns, the assets binding, `_headers` not applied to Worker responses, HTML handling, HTMLRewriter, `vars`), as
  verbatim excerpts E1-E7.
- [`../raw-sources/cloudflare-workers-html-handling-2026-11-03.md`](../raw-sources/cloudflare-workers-html-handling-2026-11-03.md)
  — ADR-0021's 2026-11-03 build note (static public pages): the whole `auto-trailing-slash` table (files served
  without a slash, folder indexes with one), grounding the guides', changelog's and landing file's URLs, as verbatim
  excerpts HH-E1 and HH-E2.
- [`../raw-sources/adsense-ad-units-and-us-states-link-2026-11-01.md`](../raw-sources/adsense-ad-units-and-us-states-link-2026-11-01.md)
  — ADR-0021 amendment 3 build step 4: the US "Do Not Sell or Share" link (rendered by Google's message on AdSense
  sites; a custom link is Ad Manager only), creating display ad units, exact-size responsive ad code, and unfilled
  units, as verbatim excerpts U-E1 to U-E6.
- [`../raw-sources/cloudflare-workers-htmlrewriter-content-2026-11-01.md`](../raw-sources/cloudflare-workers-htmlrewriter-content-2026-11-01.md)
  — ADR-0021 amendment 3 build step 4: HTMLRewriter's `append`/`prepend` and the `{ html: true }` content option,
  as verbatim excerpt HR-E1.
- [`../raw-sources/mod-0.3.0-requirements-2026-11-09.md`](../raw-sources/mod-0.3.0-requirements-2026-11-09.md)
  — the setup guides: mod 0.3.0's plugin descriptor (SML `^3.12.0`, `RequiredOnRemote` false), its release notes
  (players need SML, not the mod) and its 2026-11-09 end-to-end findings (vanilla client refused, container console
  lag, chat code typed, map layers up to about 9 minutes behind), as verbatim excerpts E1-E3.

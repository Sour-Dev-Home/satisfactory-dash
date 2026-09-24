# Wiki index

Catalog of every page in this wiki. One line per page. Updated whenever a page is
added or removed.

- [`vanilla-dedicated-server-api.md`](./vanilla-dedicated-server-api.md) — summary of
  the official Dedicated Server API (Lightweight UDP Query + HTTPS JSON-RPC): auth,
  relevant functions, and the observation that it has no production/power data model.
- [`runbooks/go-live-api.md`](./runbooks/go-live-api.md) — ordered steps to turn on the
  API: production `.env`, enforced game tokens, Scheduled Task, Cloudflare Tunnel, go-live
  tests and rollback (issue #19).
- [`frm-api.md`](./frm-api.md) — summary of FicsitRemoteMonitoring's Read API: the two
  transports (Web Server vs. tunneled Game Port API), the full endpoint index grouped
  by resource, and which endpoints are candidates for production-rate/overflow/power
  monitoring (field-level schemas still need capturing — see `log.md`).
- [`data-gap-analysis.md`](./data-gap-analysis.md) — table of player-facing metrics vs.
  API coverage. Filled in from the Phase 2 live-server spike (2026-09-21): every
  stated metric is covered by the vanilla API or FRM, no custom mod needed yet.
- [`lessons-learned.md`](./lessons-learned.md) — one-sentence-per-bug log of real bugs
  found by independent `test-hunter` review passes, with a counter that increments
  when the same pattern recurs, so repeated mistakes get visible sooner.
- [`decisions/`](./decisions/README.md) — architecture decision records (ADR-0001 onward,
  from 2026-09-22): contract, errors, units, versioning, logging, storage, caching,
  login, the auto-pause toggle, deployment, target architecture, the item-form catalog,
  frontend UI architecture and the license. The README table lists every ADR (ADR-0025,
  Postgres and Google sign-in, is accepted; ADR-0026, the offline demo mode, is accepted).
- [`architecture/`](./architecture/README.md) — D2 architecture diagrams (context, deployed
  containers, backend modules, target) with rendered SVGs and re-render instructions.

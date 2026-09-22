# Wiki index

Catalog of every page in this wiki. One line per page. Updated whenever a page is
added or removed.

- [`vanilla-dedicated-server-api.md`](./vanilla-dedicated-server-api.md) — summary of
  the official Dedicated Server API (Lightweight UDP Query + HTTPS JSON-RPC): auth,
  relevant functions, and the observation that it has no production/power data model.
- [`frm-api.md`](./frm-api.md) — summary of FicsitRemoteMonitoring's Read API: the two
  transports (Web Server vs. tunneled Game Port API), the full endpoint index grouped
  by resource, and which endpoints are candidates for production-rate/overflow/power
  monitoring (field-level schemas still need capturing — see `log.md`).
- [`data-gap-analysis.md`](./data-gap-analysis.md) — table of player-facing metrics vs.
  API coverage. Filled in from the Phase 2 live-server spike (2026-09-21): every
  stated metric is covered by the vanilla API or FRM, no custom mod needed yet.

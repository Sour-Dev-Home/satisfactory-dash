- 2026-10-27 — ADR-0056 PR 6b (#281): the delivery metrics ingest. `POST /api/internal/metrics/delivery` takes the
  daily delivery snapshot (the shared strict `DeliverySnapshotSchema`, schemaVersion 2) from a workflow with
  `Authorization: Bearer <secret>`. The backend holds only `METRICS_INGEST_SECRET_SHA256`, the hex SHA-256 of the
  secret: the presented token is hashed and compared with `timingSafeEqual`. Unset means off, and the route answers the
  unknown-route 404 (also without a database); a malformed value stops startup without echoing it. It is a public
  router (before the session guard), checks in order: off (404), 30 attempts an hour per client address (429), the
  secret (401, one message for missing, malformed or wrong; tokens under 32 characters never match), 10 accepted pushes
  an hour across the process (429), then reads the body itself with a 16 KB cap (413; `app.ts` skips the general /api
  parser for this path so an unauthenticated body is never parsed) and validates it (400, nothing echoed). New table
  `metrics.delivery_snapshots(id, received_at, generated_at, schema_version, body jsonb)` (expand-only migration
  `1792195200000_delivery_snapshots`, plus the metrics schema's missing sequence privilege for `satis_app`), pruned to
  the newest 90 on insert; query names `metrics.insertDeliverySnapshot`, `metrics.pruneDeliverySnapshots` and
  `metrics.latestDeliverySnapshot`. The metrics page's `delivery` section is now `not_configured` while the hash is
  unset, `no_data` until the first snapshot, then the newest snapshot with `asOf` = its `generatedAt`. Inert until the
  owner sets the SSM parameter (PR 6c) and the workflow (PR 6d) exists.

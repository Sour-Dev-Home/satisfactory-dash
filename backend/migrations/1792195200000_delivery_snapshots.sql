-- Up Migration
-- ADR-0056 section 4, PR 6b (#281): the delivery and CI health snapshots, pushed once a day by a workflow to
-- POST /api/internal/metrics/delivery. Each row is one snapshot: the delivery script's JSON (schemaVersion 2), validated
-- by the shared `DeliverySnapshotSchema` before it is stored. The ingest keeps the newest 90 rows (pruned on insert),
-- and the metrics page reads the newest one.
--
-- Additive (ADR-0049 D6): a new table in the existing metrics schema, plus the sequence privilege the schema's first
-- migration left out (it had no identity column). Rollback leaves a harmless table.
--
-- Nothing here is personal data: repository aggregates only (counts, rates, durations). The schema is strict, so no
-- login, title or commit SHA can be stored.

ALTER DEFAULT PRIVILEGES FOR ROLE satis_migrator IN SCHEMA metrics
  GRANT USAGE, SELECT ON SEQUENCES TO satis_app;

CREATE TABLE metrics.delivery_snapshots (
  id             bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  received_at    timestamptz NOT NULL DEFAULT now(),
  generated_at   timestamptz NOT NULL,
  schema_version integer     NOT NULL CHECK (schema_version >= 1),
  body           jsonb       NOT NULL CHECK (jsonb_typeof(body) = 'object')
);

-- Down Migration
-- Forward-only in production (ADR-0025): a rollback is the previous build plus the previous .env,
-- because schema changes are additive.

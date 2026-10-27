-- Up Migration
-- ADR-0055 amendment 2026-10-27 (#727), Decision 11: a designation's concurrency token. Bumped by every write to the row;
-- a replace (merge, split, dissolve, undo) names the revision it read and gets 409 designation_stale when it moved on.
-- `updated_at` cannot serve: the API truncates it to milliseconds.
--
-- Additive (ADR-0049 D6): a new NOT NULL column WITH a default, so existing rows take 1. Rollback leaves a harmless column.

ALTER TABLE map.factory_designations ADD COLUMN revision integer NOT NULL DEFAULT 1;

-- Down Migration
-- Forward-only in production (ADR-0025): a rollback is the previous build plus the previous .env,
-- because schema changes are additive.

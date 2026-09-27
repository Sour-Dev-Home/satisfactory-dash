-- Up Migration
-- ADR-0037 PR 2: one general system-metrics table (amends ADR-0036 step 3, which planned a
-- latency-only `metrics.route_latency_hourly`). Additive only.
--
--   metrics.series_hourly   one row per (hour, metric name, label set). Histograms store fixed
--                            millisecond buckets (13: 1,2,5,10,20,50,100,200,500,1k,2k,5k,+inf) so
--                            any window's percentiles come from summing bucket_counts, never from
--                            averaging percentiles. Counters store only count/sum, bucket_counts is
--                            null. An in-process flush adds its 60 s delta into the row every run
--                            (ON CONFLICT DO UPDATE), which is why the merge is addition, not
--                            replacement: multiple flushes across the hour (and across a restart)
--                            must each land exactly once, summed. Kept 90 days, purged by the
--                            existing retention worker. Only fixed metric names and closed-set label
--                            values are ever written (enforced in code by the metric registry,
--                            backend/src/platform/metrics/registry.ts) — never a URL, a user id or
--                            free text.
--
-- Nothing here is personal data: durations, counts and a closed set of label values (route
-- patterns, status classes, server public ids, query names) that describe the system, not a person.

CREATE SCHEMA metrics;

GRANT USAGE ON SCHEMA metrics TO satis_app;
ALTER DEFAULT PRIVILEGES FOR ROLE satis_migrator IN SCHEMA metrics
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO satis_app;

CREATE TABLE metrics.series_hourly (
  hour          timestamptz NOT NULL,
  metric        text        NOT NULL CHECK (length(metric) BETWEEN 1 AND 100),
  labels        jsonb       NOT NULL CHECK (jsonb_typeof(labels) = 'object'),
  count         integer     NOT NULL CHECK (count >= 0),
  sum           double precision NOT NULL CHECK (sum >= 0),
  -- 13 fixed millisecond buckets for a histogram metric; null for a counter metric (count/sum only).
  bucket_counts integer[]   CHECK (bucket_counts IS NULL OR array_length(bucket_counts, 1) = 13),
  PRIMARY KEY (hour, metric, labels)
);
CREATE INDEX series_hourly_hour_idx ON metrics.series_hourly (hour);

-- Element-wise sum of two same-length bucket arrays, treating a null side as "no buckets yet" rather
-- than an error, so the first flush into a fresh row (excluded vs. a null column, or vice versa on a
-- retried insert that raced another) never fails. Pure and immutable: no table access, so it needs
-- none of the audit-purge function's SECURITY DEFINER hardening.
CREATE FUNCTION metrics.merge_bucket_counts(a integer[], b integer[]) RETURNS integer[]
  LANGUAGE sql
  IMMUTABLE
  PARALLEL SAFE
  SET search_path = pg_catalog
AS $$
  SELECT CASE
    WHEN a IS NULL THEN b
    WHEN b IS NULL THEN a
    ELSE (
      SELECT array_agg(ta.av + tb.bv ORDER BY ta.ord)
      FROM unnest(a) WITH ORDINALITY AS ta (av, ord)
      JOIN unnest(b) WITH ORDINALITY AS tb (bv, ord) ON ta.ord = tb.ord
    )
  END
$$;

-- Down Migration
-- Forward-only in production (ADR-0025): a rollback is the previous build plus the previous .env,
-- because schema changes are additive.

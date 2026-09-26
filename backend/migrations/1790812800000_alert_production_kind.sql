-- Up Migration
-- ADR-0027 amendment 3 (PR 5c): the rule kind `production_below_target`. Additive: the CHECK on `alerts.rules.kind`
-- only gains a value, so every existing row stays valid and the previous build keeps working (it skips a rule whose
-- kind it cannot read). No preset is seeded: the rule is opt-in per item, created through the rules API (PR 7).
ALTER TABLE alerts.rules DROP CONSTRAINT rules_kind_check;
ALTER TABLE alerts.rules ADD CONSTRAINT rules_kind_check
  CHECK (kind IN ('power_outage', 'fuse_trip', 'stopped_machines', 'server_unreachable', 'production_below_target'));

-- Down Migration
-- Forward-only in production (ADR-0025): a rollback is the previous build plus the previous .env,
-- because schema changes are additive.

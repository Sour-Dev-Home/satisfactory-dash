-- Up Migration
-- ADR-0025: one schema per module (ADR-0014). Tables arrive with the repositories (PR 3).
-- satis_migrator (the database owner) runs this; satis_app gets DML on these schemas only, never DDL.

CREATE SCHEMA IF NOT EXISTS identity;
CREATE SCHEMA IF NOT EXISTS servers;
CREATE SCHEMA IF NOT EXISTS audit;

GRANT USAGE ON SCHEMA identity, servers, audit TO satis_app;

-- Tables and sequences created later by satis_migrator are usable by satis_app without a
-- per-migration GRANT.
ALTER DEFAULT PRIVILEGES FOR ROLE satis_migrator IN SCHEMA identity, servers, audit
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO satis_app;
ALTER DEFAULT PRIVILEGES FOR ROLE satis_migrator IN SCHEMA identity, servers, audit
  GRANT USAGE, SELECT ON SEQUENCES TO satis_app;

-- Down Migration
-- Forward-only in production (ADR-0025): a rollback is the previous build plus the previous .env,
-- because schema changes are additive. Nothing to undo here.

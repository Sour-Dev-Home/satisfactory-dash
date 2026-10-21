-- Up Migration
-- ADR-0047 amendment (#311): removing a server from Satisfactory Dash also clears its name. The soft-deleted row keeps
-- only its ids (the internal uuid the audit trail points at, and the public id that stops a self-serve id being handed out
-- again and lets an operator path revive it), so the record that stays holds nothing a person typed. Every removal path
-- runs the same statement (`softDeleteServerInTransaction`: the operator's remove-server and HTTP remove, the owner's
-- remove, the pending sweep and account deletion), which now sets display_name to NULL.
--
-- 1. display_name may be NULL. The length CHECK (1 to 64) stays and passes for NULL.
-- 2. A live server always has a name: a new CHECK refuses a live row (deleted_at IS NULL) without one. The revive paths
--    (the operator's create, the import and the startup registration) set the name when they bring a row back.
-- 3. Back-fill: servers removed before this migration lose their name now.
--
-- No unique constraint or index involves display_name, so clearing it frees or breaks nothing. A rollback build reads
-- display_name only of live rows, which keep it; its import revive of a removed id (keeping the old name) would be
-- refused by the CHECK and leave nothing changed.

ALTER TABLE servers.servers ALTER COLUMN display_name DROP NOT NULL;

ALTER TABLE servers.servers
  ADD CONSTRAINT servers_live_has_name CHECK (deleted_at IS NOT NULL OR display_name IS NOT NULL);

UPDATE servers.servers SET display_name = NULL WHERE deleted_at IS NOT NULL AND display_name IS NOT NULL;

-- Down Migration
-- Forward-only in production (ADR-0025): a rollback is the previous build plus the previous .env,
-- because schema changes are additive.

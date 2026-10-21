-- Up Migration
-- #516 (ADR-0045 "Retention"): removing a server now also clears map.world_layers and alerts.push_optins (the soft delete
-- in serverRepository.ts). Servers removed BEFORE that change left those rows behind, and a re-created public id revives
-- the old row (same internal id), so it would inherit them. This one-time clean-up deletes the leftovers of every server
-- that is already soft-deleted. Data only, no schema change, and safe to repeat (a live server is never touched).

DELETE FROM map.world_layers
WHERE server_id IN (SELECT id FROM servers.servers WHERE deleted_at IS NOT NULL);

DELETE FROM alerts.push_optins
WHERE server_id IN (SELECT id FROM servers.servers WHERE deleted_at IS NOT NULL);

-- Down Migration
-- Forward-only in production (ADR-0025): a rollback is the previous build plus the previous .env,
-- because schema changes are additive. The deleted rows belonged to removed servers and are not restored.

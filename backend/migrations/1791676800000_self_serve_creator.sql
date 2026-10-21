-- Up Migration
-- #526 (ADR-0046 task 4, from #525's security review): who CREATED a self-serve server, so the per-account caps count the
-- creator and not the current owner.
--
-- 1. servers.servers.created_by_user_id: the account that created the server, set by the self-serve create in the same
--    INSERT. C1 (servers per account), C3 (pending servers per account) and C5 (creations per account per 24 hours) count
--    by it, so handing a server to another account (servers.transferOwnership, or a later invite) never frees a slot, and
--    C5 is a count of rows, which survives a restart and counts removed servers too (a removed row keeps created_at and
--    created_by_user_id). A deleted account's servers keep their row with the column set to NULL (#311 decides what else
--    goes with the account); a user id is the only thing stored, never a name or an email.
-- 2. Back-fill for self-serve rows created before this column: the `server.created` audit actor (the creator, written in
--    the create transaction), else the current owner. Only ids that are still accounts, so the foreign key holds.
-- 3. One partial index for the three counts: (created_by_user_id, created_at) over self-serve rows only, live or removed.
--
-- Additive: a nullable column, a back-fill of rows the application already wrote, and an index.

ALTER TABLE servers.servers
  ADD COLUMN created_by_user_id uuid REFERENCES identity.users (id) ON DELETE SET NULL;

UPDATE servers.servers s
SET created_by_user_id = COALESCE(
  (SELECT a.actor_user_id
     FROM audit.audit_events a
     JOIN identity.users u ON u.id = a.actor_user_id
    WHERE a.server_id = s.id AND a.action = 'server.created'
    ORDER BY a.at, a.id
    LIMIT 1),
  (SELECT m.user_id
     FROM servers.server_members m
    WHERE m.server_id = s.id AND m.role = 'owner')
)
WHERE s.created_via = 'self_serve' AND s.created_by_user_id IS NULL;

CREATE INDEX servers_self_serve_creator_idx
  ON servers.servers (created_by_user_id, created_at)
  WHERE created_via = 'self_serve';

-- Down Migration
-- Forward-only in production (ADR-0025): a rollback is the previous build plus the previous .env,
-- because schema changes are additive.

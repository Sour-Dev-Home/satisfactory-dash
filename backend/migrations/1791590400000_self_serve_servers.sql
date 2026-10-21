-- Up Migration
-- #525 (ADR-0046 task 3): servers a signed-in player creates without the operator.
--
-- 1. servers.servers.created_via says who created a server: 'operator' (every path that exists today: the management
--    routes, the import and the startup registration) or 'self_serve' (POST /api/servers/agent). The default makes every
--    existing row 'operator'. The caps, the managed list and the pending-server sweep key on it.
-- 2. #311's rule for a new self-serve server, in the database: a deferred constraint trigger on INSERT refuses a commit
--    that leaves a live 'self_serve' server with no owner row. The membership trigger (1791244800000) fires only when a
--    membership is deleted or changed, so a server inserted with no membership at all was the service's job alone.
--    Operator-created rows stay exempt (the startup seed gives them the operator as owner). The error names the server's
--    internal id only; nothing personal is stored or logged.
--
-- Additive: one column with a default and one trigger that refuses only a write the application never makes.

ALTER TABLE servers.servers
  ADD COLUMN created_via text NOT NULL DEFAULT 'operator' CHECK (created_via IN ('operator', 'self_serve'));

CREATE FUNCTION servers.assert_self_serve_server_has_owner() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  -- Re-read at commit: the row may have been removed (or soft-deleted) later in the same transaction.
  IF EXISTS (SELECT 1 FROM servers.servers s WHERE s.id = NEW.id AND s.created_via = 'self_serve' AND s.deleted_at IS NULL)
     AND NOT EXISTS (SELECT 1 FROM servers.server_members m WHERE m.server_id = NEW.id AND m.role = 'owner')
  THEN
    RAISE EXCEPTION 'ownerless_server'
      USING ERRCODE = 'check_violation',
            CONSTRAINT = 'servers_self_serve_has_owner',
            DETAIL = format('self-serve server %s was created without an owner', NEW.id);
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER servers_self_serve_has_owner
  AFTER INSERT ON servers.servers
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION servers.assert_self_serve_server_has_owner();

-- Down Migration
-- Forward-only in production (ADR-0025): a rollback is the previous build plus the previous .env,
-- because schema changes are additive.

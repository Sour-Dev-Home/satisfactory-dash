-- Up Migration
-- #311: a live server is never left without an owner, enforced by the database. The one-owner index
-- (core_tables) allows AT MOST one owner; this adds the other half. Deleting an account cascades its
-- memberships away, so without it an owner's account deletion would orphan the server.
--
-- A constraint trigger, DEFERRABLE INITIALLY DEFERRED, on servers.server_members. It fires per row that
-- is deleted or loses the 'owner' role, but only CHECKS at commit, so a transaction may pass through an
-- ownerless moment: transferOwnership demotes then promotes, and a soft delete marks the server deleted
-- and then deletes its members. At commit, a server that is live (deleted_at IS NULL) and still exists
-- but has no owner row raises `ownerless_server`. A server that was hard-deleted (the cascade) or
-- soft-deleted is not checked. Nothing personal is stored or logged: the error carries the server's
-- internal id only.
--
-- Additive: no data changes, and it only refuses a write the application never makes. An ownerless
-- server that already exists is left alone (the trigger fires on a change, not on existing rows).

CREATE FUNCTION servers.assert_server_has_owner() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.role = 'owner'
     AND EXISTS (SELECT 1 FROM servers.servers s WHERE s.id = OLD.server_id AND s.deleted_at IS NULL)
     AND NOT EXISTS (SELECT 1 FROM servers.server_members m WHERE m.server_id = OLD.server_id AND m.role = 'owner')
  THEN
    RAISE EXCEPTION 'ownerless_server'
      USING ERRCODE = 'check_violation',
            CONSTRAINT = 'server_members_never_ownerless',
            DETAIL = format('server %s would be left without an owner', OLD.server_id);
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER server_members_never_ownerless
  AFTER DELETE OR UPDATE OF role ON servers.server_members
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION servers.assert_server_has_owner();

-- Down Migration
-- Forward-only in production (ADR-0025): a rollback is the previous build plus the previous .env,
-- because schema changes are additive.

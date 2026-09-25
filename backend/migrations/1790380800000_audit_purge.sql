-- Up Migration
-- Audit retention (privacy policy: audit events are kept 1 year). The trail is append-only for the
-- runtime role (satis_app has no UPDATE or DELETE on audit.audit_events, by design), so expiry needs
-- one narrow, audited door: this function. It is owned by the migrator (the table's owner, who may
-- delete), runs with the owner's rights (SECURITY DEFINER) and does exactly one thing: delete events
-- older than a year and say how many. Nothing else about the trail becomes deletable.
--
-- Standard SECURITY DEFINER hardening: a fixed search_path (pg_catalog first, then audit only, so a
-- caller's own search_path or a same-named table elsewhere can never be reached), every object name
-- schema-qualified, EXECUTE revoked from PUBLIC and granted to the runtime role alone.
CREATE FUNCTION audit.purge_expired_events() RETURNS bigint
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, audit
AS $$
  WITH deleted AS (
    DELETE FROM audit.audit_events
    WHERE at < pg_catalog.now() - interval '1 year'
    RETURNING 1
  )
  SELECT pg_catalog.count(*) FROM deleted
$$;

ALTER FUNCTION audit.purge_expired_events() OWNER TO satis_migrator;
REVOKE ALL ON FUNCTION audit.purge_expired_events() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION audit.purge_expired_events() TO satis_app;

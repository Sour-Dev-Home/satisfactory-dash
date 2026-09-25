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
  ),
  purged AS (
    SELECT pg_catalog.count(*) AS n FROM deleted
  ),
  -- The purge leaves its own trace, but only when it removed something (no daily noise rows): the
  -- count and nothing else, no personal data. Same statement, so the two can never disagree.
  trace AS (
    INSERT INTO audit.audit_events (action, detail)
    SELECT 'audit.retention_purge', pg_catalog.jsonb_build_object('count', n) FROM purged WHERE n > 0
    RETURNING 1
  )
  SELECT n FROM purged
$$;

ALTER FUNCTION audit.purge_expired_events() OWNER TO satis_migrator;
REVOKE ALL ON FUNCTION audit.purge_expired_events() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION audit.purge_expired_events() TO satis_app;

-- The app never sets `at`: make it a DATABASE guarantee, not a convention. Every insert omits `at` (it
-- defaults to now()), but table-level INSERT covers every column, so a bug could back-date a row (purged
-- early) or future-date one (never purged). Column-level INSERT names only what the app may set.
REVOKE INSERT ON audit.audit_events FROM satis_app;
GRANT INSERT (actor_user_id, server_id, action, detail) ON audit.audit_events TO satis_app;

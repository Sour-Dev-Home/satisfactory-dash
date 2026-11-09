-- Up Migration
-- ADR-0066 Decision 7, step 1 (build PR 5): direct polling is retired, so every live `local` server becomes an `agent`
-- server awaiting the mod. The operator mints an enrolment code for it and enrols the mod; its history, members, alert
-- rules and public id are untouched. A removed (soft-deleted) row is left as it is.
--
-- Data, not schema (ADR-0049 D6): no column, constraint or table changes. Safe during a rolling deploy: the old backend
-- loads an `agent` row without a credential exactly as it loads a self-serve server awaiting its first enrolment, so the
-- only effect on an old task is that its polling of these servers stops. The sealed tokens stay in
-- `servers.server_connections`, unread, until the owner-gated contract step (PR 10) drops that table; until then this
-- step is reversible with the previous image plus an UPDATE back to 'local'.

UPDATE servers.servers SET connection_kind = 'agent' WHERE connection_kind = 'local' AND deleted_at IS NULL;

-- Down Migration
-- Forward-only in production (ADR-0025): a rollback is the previous build plus the previous .env. The rows that were
-- `local` are not recorded here; a server with a row in `servers.server_connections` was one.

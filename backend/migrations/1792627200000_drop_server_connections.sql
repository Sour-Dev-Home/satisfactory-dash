-- Up Migration
-- ADR-0066 Decision 7, step 2 (build PR 10b): direct polling is retired and every former `local` server is an `agent`
-- server (PR 5), so the sealed game tokens in `servers.server_connections` have no reader. This destroys them, and it
-- cannot be undone: the only way back is a restore from the owner's backup (runbooks/backups.md).
--
-- contract: no running or rollback image reads or writes the table (PR 10a shipped >= 1 release ago and the owner took a backup)
--
-- DROP TABLE takes the table's own index, constraints and grants with it. No view, function or other table's foreign key
-- refers to it. `servers.servers.connection_kind` and its CHECK stay as they are (ADR-0066 Decision 7).

DROP TABLE servers.server_connections;

-- Down Migration
-- Irreversible: the sealed tokens are gone. A rollback is the previous build (PR 10a or later, which never touches the
-- table) plus the previous .env; recovering the rows themselves means restoring the backup taken before this release.

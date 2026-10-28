-- Up Migration
-- ADR-0061 Decision 7: nested Planner designations. `parent_id` names the designation this one sits in; null = top level.
-- The foreign key is on (server_id, parent_id), so a parent is always on the same server, and ON DELETE RESTRICT: a
-- parent is never deleted from under its children (the route re-parents them first, in the same transaction). Depth,
-- cycles and "members or children" are the route's checks (ADR-0061 Contracts 3 and 4), under the server row lock.
--
-- Additive (ADR-0049 D6): a nullable column, so every existing row is top level, and a constraint no existing row can
-- breach (every parent_id is null). The previous build ignores the column, so a rollback shows nested designations flat.

ALTER TABLE map.factory_designations ADD COLUMN parent_id uuid;

ALTER TABLE map.factory_designations
  ADD CONSTRAINT factory_designations_parent_fk FOREIGN KEY (server_id, parent_id)
  REFERENCES map.factory_designations (server_id, id) ON DELETE RESTRICT;

-- Down Migration
-- Forward-only in production (ADR-0025): a rollback is the previous build plus the previous .env,
-- because schema changes are additive.

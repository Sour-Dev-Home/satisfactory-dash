-- Up Migration
-- ADR-0061 Contracts 3: a designation with children may own no machines itself, so `members` may be an empty array.
-- The route still refuses an empty designation without children (409 designation_shape).
--
-- contract: this drops the members CHECK only to add it back wider under the same name (1..1000 becomes 0..1000), in
-- one statement. Every existing row still passes, the old backend only ever writes 1 or more members, and the previous
-- build (#800's contract) already reads an empty members array. Its own file so the check reads the parent migration.

ALTER TABLE map.factory_designations
  DROP CONSTRAINT factory_designations_members_check,
  ADD CONSTRAINT factory_designations_members_check CHECK (jsonb_typeof(members) = 'array' AND jsonb_array_length(members) BETWEEN 0 AND 1000);

-- Down Migration
-- Forward-only in production (ADR-0025): a rollback is the previous build plus the previous .env,
-- because schema changes are additive.

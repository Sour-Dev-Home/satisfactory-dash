-- Up Migration
-- #740 follow-up: the agent's own view of its game connection, the latest values of the snapshot's optional
-- `gameReachable`, `lastGameReadAt` and `modVersion`, so the agent status can show them after a backend restart (like
-- `agent_version`). NULL = not reported (an older agent, or none since it enrolled). `last_game_read_at` only moves
-- forward (the UPDATE uses GREATEST). The backend validates `mod_version` (1 to 64 characters) before writing it.
--
-- Additive (ADR-0049 D6): three nullable columns without defaults. Rollback leaves harmless columns.

ALTER TABLE agents.agent_credentials
  ADD COLUMN game_reachable boolean,
  ADD COLUMN last_game_read_at timestamptz,
  ADD COLUMN mod_version text;

-- Down Migration
-- Forward-only in production (ADR-0025): a rollback is the previous build plus the previous .env,
-- because schema changes are additive.

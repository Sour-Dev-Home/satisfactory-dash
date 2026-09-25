-- Up Migration
-- ADR-0030 PR 3: how to reach a server moves from local config into the database. Additive only.
--   * servers.servers.connection_kind: 'local' (reached directly by this backend; operator only) or
--     'agent' (a player's server, reached only through their edge agent, phase 2). Existing rows are 'local'.
--   * servers.server_connections: one row per local server. The game tokens are AES-256-GCM sealed by
--     platform/secrets (nonce || ciphertext || tag); key_id names the key that sealed BOTH of them, so
--     a rotation can leave old rows readable. The database never holds a plaintext token.

ALTER TABLE servers.servers
  ADD COLUMN connection_kind text NOT NULL DEFAULT 'local' CHECK (connection_kind IN ('local', 'agent'));

CREATE TABLE servers.server_connections (
  server_id     uuid        PRIMARY KEY REFERENCES servers.servers (id) ON DELETE CASCADE,
  -- What the operator typed (a hostname or an address); shown back to them.
  host          text        NOT NULL CHECK (length(host) BETWEEN 1 AND 253),
  -- The address the backend connects to (ADR-0030 decision 2): validated when saved, a single host
  -- address (never a network), and re-validated on every connect.
  pinned_ip     inet        NOT NULL CHECK (masklen(pinned_ip) = CASE family(pinned_ip) WHEN 4 THEN 32 ELSE 128 END),
  api_port      integer     NOT NULL CHECK (api_port BETWEEN 1 AND 65535),
  frm_port      integer     NOT NULL CHECK (frm_port BETWEEN 1 AND 65535),
  -- nonce (12) + tag (16) + at least 1 byte of ciphertext; the upper bound stops a runaway value.
  api_token_enc bytea       NOT NULL CHECK (length(api_token_enc) BETWEEN 29 AND 8300),
  -- FRM's token is optional (FRM can run without one).
  frm_token_enc bytea       CHECK (frm_token_enc IS NULL OR length(frm_token_enc) BETWEEN 29 AND 8300),
  key_id        text        NOT NULL CHECK (key_id ~ '^[A-Za-z0-9_-]{1,32}$'),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX server_connections_key_idx ON servers.server_connections (key_id);

-- Down Migration
-- Forward-only in production (ADR-0025): a rollback is the previous build plus the previous .env,
-- because schema changes are additive.

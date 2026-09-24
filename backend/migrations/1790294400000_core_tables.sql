-- Up Migration
-- ADR-0025 PR 3 (ADR-0020 data model, phase 1): accounts, sessions, the server registry,
-- memberships and the audit trail. Rules live in constraints, so a repository bug or a second
-- writer cannot break them.

-- ---------------------------------------------------------------------------------------------
-- identity
-- ---------------------------------------------------------------------------------------------
CREATE TABLE identity.users (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  display_name text        NOT NULL CHECK (length(display_name) BETWEEN 1 AND 100),
  -- Stored lowercase and never a key: identities are keyed on (provider, subject), not on email.
  email        text        CHECK (email IS NULL OR (email = lower(email) AND length(email) BETWEEN 3 AND 320)),
  status       text        NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX users_email_idx ON identity.users (email) WHERE email IS NOT NULL;

CREATE TABLE identity.auth_identities (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid        NOT NULL REFERENCES identity.users (id) ON DELETE CASCADE,
  provider         text        NOT NULL CHECK (provider IN ('local', 'google')),
  provider_subject text        NOT NULL CHECK (length(provider_subject) BETWEEN 1 AND 255),
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_subject),
  UNIQUE (user_id, provider)
);

-- One row per in-flight OIDC login (state, nonce, PKCE verifier). The browser holds only the
-- random id; the table stores its sha256. Consumed once by a guarded DELETE ... RETURNING.
CREATE TABLE identity.login_attempts (
  id_hash       bytea       PRIMARY KEY CHECK (length(id_hash) = 32),
  state         text        NOT NULL CHECK (length(state) BETWEEN 16 AND 256),
  nonce         text        NOT NULL CHECK (length(nonce) BETWEEN 16 AND 256),
  code_verifier text        NOT NULL CHECK (length(code_verifier) BETWEEN 43 AND 128),
  -- A relative /app path only, so a login can never redirect off-site (no "//", no backslash).
  -- Dot segments are refused as well: no legitimate return path needs ".." and it keeps the rule easy to audit.
  return_path   text        NOT NULL CHECK (return_path ~ '^/app([/?#][^\\[:cntrl:]]*)?$' AND position('..' in return_path) = 0),
  created_at   timestamptz  NOT NULL DEFAULT now(),
  expires_at   timestamptz  NOT NULL,
  CHECK (expires_at > created_at)
);
CREATE INDEX login_attempts_expires_idx ON identity.login_attempts (expires_at);

-- Server-side sessions: only sha256(session id) is stored, so a database leak cannot be replayed.
CREATE TABLE identity.sessions (
  id_hash      bytea       PRIMARY KEY CHECK (length(id_hash) = 32),
  user_id      uuid        NOT NULL REFERENCES identity.users (id) ON DELETE CASCADE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  revoked_at   timestamptz,
  last_seen_at timestamptz,
  CHECK (expires_at > created_at)
);
CREATE INDEX sessions_user_idx    ON identity.sessions (user_id);
CREATE INDEX sessions_expires_idx ON identity.sessions (expires_at);

-- ---------------------------------------------------------------------------------------------
-- servers
-- ---------------------------------------------------------------------------------------------
CREATE TABLE servers.servers (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  -- The public id in every /api/servers/:serverId URL (shared ServerIdSchema).
  public_id    text        NOT NULL UNIQUE CHECK (public_id ~ '^[a-z0-9-]{1,32}$'),
  display_name text        NOT NULL CHECK (length(display_name) BETWEEN 1 AND 64),
  hosting_mode text        NOT NULL DEFAULT 'self' CHECK (hosting_mode IN ('self', 'managed')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  deleted_at   timestamptz
);

CREATE TABLE servers.server_members (
  server_id  uuid        NOT NULL REFERENCES servers.servers (id) ON DELETE CASCADE,
  user_id    uuid        NOT NULL REFERENCES identity.users (id) ON DELETE CASCADE,
  role       text        NOT NULL CHECK (role IN ('owner', 'admin', 'viewer')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (server_id, user_id)
);
-- Exactly one owner per server, at most: the database refuses a second one.
CREATE UNIQUE INDEX server_members_one_owner ON servers.server_members (server_id) WHERE role = 'owner';
CREATE INDEX server_members_user_idx ON servers.server_members (user_id);

-- ---------------------------------------------------------------------------------------------
-- audit
-- ---------------------------------------------------------------------------------------------
-- Append-only. No foreign keys, so the trail outlives the users and servers it mentions.
CREATE TABLE audit.audit_events (
  id            bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  at            timestamptz NOT NULL DEFAULT now(),
  actor_user_id uuid,
  server_id     uuid,
  action        text        NOT NULL CHECK (action ~ '^[a-z][a-z0-9_.]{1,63}$'),
  detail        jsonb       NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(detail) = 'object')
);
CREATE INDEX audit_events_at_idx     ON audit.audit_events (at DESC);
CREATE INDEX audit_events_server_idx ON audit.audit_events (server_id, at DESC) WHERE server_id IS NOT NULL;
CREATE INDEX audit_events_actor_idx  ON audit.audit_events (actor_user_id, at DESC) WHERE actor_user_id IS NOT NULL;
-- The default privileges gave satis_app DML on new tables; the audit trail is insert and read only.
REVOKE UPDATE, DELETE ON audit.audit_events FROM satis_app;

-- Down Migration
-- Forward-only in production (ADR-0025): a rollback is the previous build plus the previous .env,
-- because schema changes are additive.

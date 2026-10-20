-- Up Migration
-- ADR-0044 (#348): web push as a second alert channel. Additive only, in the existing `alerts` schema.
--
--   push_subscriptions  one row per (user, browser/device). PERSONAL DATA and a bearer secret: the endpoint is a capability
--                       URL on a third-party push service, and p256dh/auth are the keys that encrypt a message to the
--                       browser. All three are stored sealed (AES-256-GCM, platform/secrets, bound to the user and the
--                       field) and never returned or logged. Only the endpoint's HOST is readable (allowlist recheck and
--                       diagnostics). A user has at most 10 (enforced by the repository under a per-user advisory lock).
--                       Deleting the user deletes their subscriptions, which is what keeps account deletion (#311) whole.
--   push_optins         which servers a user wants push alerts for. Any member may opt in; membership is rechecked when
--                       a message is queued and again when it is sent (348-2), so a removed member gets nothing.
--   outbox              a second kind of target. A row has EXACTLY ONE of destination_id (Discord) or push_subscription_id
--                       (push). The existing UNIQUE (event_id, destination_id) stays as it is: NULLs are distinct in a
--                       unique constraint, so push rows never collide with it, and the previous build's
--                       `ON CONFLICT (event_id, destination_id)` keeps working (rollback-safe). A second, partial unique
--                       index makes (event_id, push_subscription_id) the idempotency key for push.

CREATE TABLE alerts.push_subscriptions (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid        NOT NULL REFERENCES identity.users (id) ON DELETE CASCADE,
  -- nonce || ciphertext || tag (28 bytes of overhead), with the id of the key that sealed all three.
  endpoint_enc    bytea       NOT NULL CHECK (octet_length(endpoint_enc) BETWEEN 29 AND 2200),
  p256dh_enc      bytea       NOT NULL CHECK (octet_length(p256dh_enc) BETWEEN 29 AND 256),
  auth_enc        bytea       NOT NULL CHECK (octet_length(auth_enc) BETWEEN 29 AND 256),
  key_id          text        NOT NULL CHECK (key_id ~ '^[A-Za-z0-9_-]{1,32}$'),
  -- The only readable part of the endpoint.
  endpoint_host   text        NOT NULL CHECK (length(endpoint_host) BETWEEN 1 AND 255),
  -- sha256 of the canonical endpoint: the same endpoint twice is one subscription (per user).
  endpoint_hash   bytea       NOT NULL CHECK (octet_length(endpoint_hash) = 32),
  created_at      timestamptz NOT NULL DEFAULT now(),
  last_success_at timestamptz,
  UNIQUE (user_id, endpoint_hash)
);

CREATE TABLE alerts.push_optins (
  server_id  uuid        NOT NULL REFERENCES servers.servers (id) ON DELETE CASCADE,
  user_id    uuid        NOT NULL REFERENCES identity.users (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (server_id, user_id)
);
CREATE INDEX push_optins_user_idx ON alerts.push_optins (user_id);

ALTER TABLE alerts.outbox
  ADD COLUMN push_subscription_id uuid REFERENCES alerts.push_subscriptions (id) ON DELETE CASCADE,
  ALTER COLUMN destination_id DROP NOT NULL,
  ADD CONSTRAINT outbox_one_target CHECK (num_nonnulls(destination_id, push_subscription_id) = 1);
CREATE UNIQUE INDEX outbox_event_push_uq ON alerts.outbox (event_id, push_subscription_id) WHERE push_subscription_id IS NOT NULL;
CREATE INDEX outbox_push_subscription_idx ON alerts.outbox (push_subscription_id) WHERE push_subscription_id IS NOT NULL;

-- Down Migration
-- Forward-only in production (ADR-0025): a rollback is the previous build plus the previous .env,
-- because schema changes are additive.

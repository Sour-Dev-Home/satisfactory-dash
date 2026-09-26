-- Up Migration
-- ADR-0027 PR 6: alert delivery. Additive only, in the existing `alerts` schema.
--
--   destinations  where a server's alerts go (Discord first): the webhook URL is a BEARER SECRET, so it is stored
--                 encrypted (AES-256-GCM, platform/secrets, bound to the server) and only its last 4 characters are
--                 kept readable. One per (server, kind).
--   outbox        the transactional outbox: one row per (alert event, destination), written in the SAME transaction
--                 as the event (never while ALERT_DELIVERY is off). A sender claims due rows with FOR UPDATE SKIP
--                 LOCKED. Delivery is at-least-once; (event_id, destination_id) is the idempotency key.
--
-- Nothing here is personal data: the destination is a webhook, the outbox refers to game events.

CREATE TABLE alerts.destinations (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  server_id       uuid        NOT NULL REFERENCES servers.servers (id) ON DELETE CASCADE,
  kind            text        NOT NULL CHECK (kind IN ('discord')),
  -- nonce || ciphertext || tag (28 bytes of overhead), with the id of the key that sealed it.
  webhook_enc     bytea       NOT NULL CHECK (octet_length(webhook_enc) BETWEEN 29 AND 2048),
  key_id          text        NOT NULL CHECK (key_id ~ '^[A-Za-z0-9_-]{1,32}$'),
  -- The only part of the URL that is ever shown back.
  last4           text        NOT NULL CHECK (length(last4) = 4),
  enabled         boolean     NOT NULL DEFAULT true,
  -- Why it is off: the webhook was deleted on Discord's side (404/401), it failed the allowlist, or it was switched off.
  disabled_reason text        CHECK (disabled_reason IS NULL OR disabled_reason IN ('webhook_gone', 'invalid_url', 'manual')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (server_id, kind),
  CHECK (enabled OR disabled_reason IS NOT NULL)
);

CREATE TABLE alerts.outbox (
  id              bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_id        bigint      NOT NULL REFERENCES alerts.alert_events (id) ON DELETE CASCADE,
  destination_id  uuid        NOT NULL REFERENCES alerts.destinations (id) ON DELETE CASCADE,
  status          text        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'dead')),
  attempts        integer     NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  -- When the next attempt is due; while a row is being sent this is pushed out (the lease).
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now(),
  sent_at         timestamptz,
  -- A stable code only (rate_limited, server_error, expired, ...): never a URL, a body or an error message.
  last_error      text        CHECK (last_error IS NULL OR length(last_error) <= 40),
  UNIQUE (event_id, destination_id)
);
-- The sender's queue: due pending rows, oldest first.
CREATE INDEX outbox_due_idx ON alerts.outbox (next_attempt_at) WHERE status = 'pending';
CREATE INDEX outbox_destination_idx ON alerts.outbox (destination_id);

-- Down Migration
-- Forward-only in production (ADR-0025): a rollback is the previous build plus the previous .env,
-- because schema changes are additive.

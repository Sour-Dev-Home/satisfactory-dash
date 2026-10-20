# ADR-0044: Web push as a second alert channel

Status: accepted (owner, 2026-10-20)

## Context
- ADR-0027 delivers alerts to Discord, per server, through a transactional outbox behind the `ALERT_DELIVERY` kill
  switch. The owner asked for per-user push (#348).
- A push subscription is per user and per device, and it is personal data. Its endpoint is a capability URL on a
  third-party push service: whoever holds it (with the keys) can send that browser a message.
- The owner's answers, 2026-10-20: web push is built; the server's owner and admins set the Discord webhook, as built
  (not operator-only); iOS is supported; the push signing (VAPID) key lives in `.env` for now and in SSM after the AWS
  move; the privacy page gets a row for the browser push services.

## Decision
1. Web push (VAPID, RFC 8030 / 8291 / 8292), per-user opt-in per server, through the **same outbox and worker**.
   `alerts.outbox` gets an exactly-one-of (destination, push subscription) target
   (`CHECK (num_nonnulls(destination_id, push_subscription_id) = 1)`). The existing `UNIQUE (event_id, destination_id)`
   stays as it is: NULLs are distinct in a unique constraint, so push rows never collide with it, and the previous
   build's `ON CONFLICT (event_id, destination_id)` keeps working (rollback-safe). A partial unique index makes
   `(event_id, push_subscription_id)` the push idempotency key.
2. The endpoint and keys are sealed with `platform/secrets` (AES-256-GCM, bound to the user and the field, context
   `push:<userId>:<field>`), never returned, never logged, never in an audit row. Only the endpoint's host is readable.
   A user has at most 10 subscriptions. Subscribing twice with the same endpoint is one subscription (unique on the
   user and the sha256 of the endpoint).
3. A host allowlist on subscribe and again on send: https only, no port, no userinfo, no fragment, redirects never
   followed. This is the same SSRF rule as Discord. The list is **configuration** (`PUSH_ENDPOINT_HOSTS`,
   comma-separated; an entry is an exact host or `*.suffix`; setting it replaces the default).
   - Default entries: `fcm.googleapis.com`, `updates.push.services.mozilla.com`, `*.notify.windows.com`.
   - Apple's push server address is not in the default list. **[NEEDS VERIFICATION]**: capture real endpoints from
     Chrome, Firefox, Edge and Safari before fixing the list, then add Apple's host to the default or to the
     production `PUSH_ENDPOINT_HOSTS`. Until then an iOS subscription is refused with `push_endpoint_invalid`
     (`host_not_allowed`).
4. VAPID keys come from the environment: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, all three or none
   (anything else stops the backend at startup, naming the variable but never a value). They live in `.env` now and in SSM
   `/satis/prod/*` after the AWS move (ADR-0034). Rotating them invalidates all subscriptions, so they are rotated only on
   compromise. Push is enabled only with `ALERT_DELIVERY=on`, VAPID configured and the secrets keyring present; otherwise
   `GET /api/push/config` answers `enabled: false` and subscribing answers `push_disabled` (409).
5. Recipients are resolved at write time from the current members who opted in, and rechecked at send time, so a removed
   member gets nothing. Any member of a server, a viewer included, may set their own opt-in for it: it is their own
   notification and no server setting.
6. iOS is supported. Safari delivers web push only to a Home Screen web app (iOS 16.4 and later), which needs a web app
   manifest: that is part of the frontend task (348-3). **[NEEDS VERIFICATION]**: the iOS version floor and the
   manifest requirements, against Apple's documentation, when 348-3 is built.
7. Payload and size limits are set in the sender task (348-2). **[NEEDS VERIFICATION]**: the exact payload cap per push
   service (about 4 KB is the commonly quoted figure); the plan keeps the plaintext at or under 3 KB until it is checked.

## Build plan
- 348-1 (this ADR): the shared contract (`/api/push/config`, `/api/push/subscriptions`, `/api/push/subscriptions/:id`,
  `.../test`, and `GET`/`PUT /api/servers/:serverId/alerts/push`), the storage migration, the repository, the routes
  and VAPID loading. No sending, no service worker, no UI.
- 348-2: the push sender in the outbox worker (RFC 8291 encryption, VAPID JWT, `gone` deletes the subscription).
- 348-3: the service worker, the opt-in UI, the web app manifest, and the privacy page row naming the browser push
  services (their text is approved by the owner).

## Consequences
- The first per-user delivery state. Account deletion (#311) must remove it, which the foreign-key cascade does.
- The privacy page gains a processor row for the browser push services (Google, Mozilla, Apple, Microsoft). The payload is
  end-to-end encrypted, so they see only that a message was sent, and when.
- Without a manifest, iOS users get no push.
- A new secret (the VAPID private key) joins `.env`; it is never returned by an API or logged.

## Revisit when
- Email (SES) is added, so preferences become a per-user channel table.
- A user has more than 10 devices.
- Push volume makes the worker's batch of 10 every 10 s too slow (measure outbox lag first).

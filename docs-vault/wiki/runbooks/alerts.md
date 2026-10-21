# Runbook: the alert engine (ADR-0027 PR 5)

With a database, the backend evaluates each server's alert rules every 30 seconds and records what happened in the
**alert log**. This PR only RECORDS events: nothing is sent anywhere until the delivery PR (the outbox and Discord,
behind `ALERT_DELIVERY`, default off). So the first deploy is a **shadow run**: read the log for about a week before
turning delivery on.

## Deploy order

**The backend will not start against a database that has not been migrated** (the schema version check,
ADR-0025). The release that brings alerts needs `npm run db:migrate -w backend` first (it adds the `alerts` schema:
`1790640000000_alerts`, additive). Nothing else needs configuring; the preset rules are seeded on the first tick,
for every server (existing ones included) and for servers added later.

## What is evaluated

The engine reads what the pollers last saw (in memory: no game-server call, no history query). A reading older than
twice its poller's interval is **unknown**, and every subject then holds its last condition (never a guess).

| Rule (kind) | Preset | Subject | Condition | For / clear / repeat | Severity |
|---|---|---|---|---|---|
| `power_outage` | yes | one per circuit | the circuit's status is `outage` (a tripped fuse today) | 0 / 60 s / 1 h | critical |
| `stopped_machines` | yes | `group` (one alert for all machines) | a machine is `underfed` (input short) or `backedUp` (output full) AND its best output percent is below 5, held for `for`; the alert says why per machine ("input short: <ingredient>", "output full") | 5 min / 2 min / 1 h | warning |
| `server_unreachable` | yes | `server` | 3 failed status polls in a row AND at least 2 minutes | 0 / 60 s / 1 h | critical |
| `agent_offline` | **only for a server reached through an edge agent** (ADR-0031) | `agent` | no snapshot of any kind from the agent for 2 minutes (`offlineSeconds`, at least 60), measured from the later of the last snapshot and the backend's start; speaks through a paused game and an unreachable game server | 0 / 60 s / 1 h | critical |
| `fuse_trip` | **no** | one per circuit | `fuseTriggered` | 0 / 60 s / 1 h | critical |
| `production_below_target` | **no** (opt-in per item) | `item` (one rule per item) | the factory-wide rate of the item, averaged over a rolling window (5 to 60 min, default 10), is below 90% of the target; it clears above 95%, and in between the last answer stands | 10 min / 5 min / 1 h | warning |

`fuse_trip` exists but is not seeded: today "outage" IS a tripped fuse, so both would say the same thing twice.
"Newly underfed" is not offered (ADR-0027 amendment 2).

`production_below_target` (amendment 3) has no preset, because a target only means something for a chosen item. Its
parameters are `item` (the class name), `targetPerMinute` (above 0) and `windowMinutes`. Rules are created through the
rules API (PR 7); until then a row can only be inserted by hand. The window lives in memory, fed by the factory poller
(one sample per 30 s reading, no database reads), so **after a restart, a pause, an unreachable stretch, a mute, a
stale reading or a change of game session it starts empty**: the rule decides nothing (a firing alert holds, a new
one waits) until the window is full again, and only then does `for` start. An item nobody makes counts as a rate of 0,
so it fires. It follows the same `ALERT_DELIVERY` switch and shadow week as the other kinds. Migration
`1790812800000_alert_production_kind` (a deploy needs `db:migrate` first) only widens the kind CHECK.

Transitions: `fired`, `renotify` (at most once per repeat interval while it keeps firing), `resolved` (only after the
condition has been false for the whole clear duration), and, for the grouped machine alert only, `updated` (new
machines joined a group that is already firing, at most once per 10 minutes, so a second breakage is not silent for an
hour).

## Suppression (no floods)

- **The game is paused** (auto-pause when nobody is on): the power and machine rules are not evaluated. FRM returns
  frozen values then. The first factory snapshot after a resume counts as unknown too.
- **The server is unreachable**: the same, and `server_unreachable` is the one alert that speaks. Auto-pause is not
  unreachable. The PC being off is for the external uptime monitor (ADR-0028), not this engine.
- **Muted** (`alerts.server_mutes`, set through the rules API in a later PR): nothing at all is evaluated.
- When suppression ends, a pending run is dropped (the condition was not observed during the gap, so it must be seen
  again), a firing alert stays firing (silence is not a resolve) and a half-way clear starts over.

## Restarts

The state of every (rule, subject) is stored (`alerts.alert_state`) and written in ONE transaction with its event, so a
restart reloads it and does not fire again. The per-machine timers of the grouped alert are in memory: a restart only
delays a NEW alert by up to `for`, and a group that was firing adopts the machines that are stopped right now instead
of resolving and firing again. A tick that fails because the database is down is logged once and skipped with no state
change; the next tick reproduces the same transitions.

## Reading the alert log

```sql
SELECT e.at, s.public_id AS server, e.kind, e.subject, e.transition, e.summary
FROM alerts.alert_events e JOIN servers.servers s ON s.id = e.server_id
ORDER BY e.at DESC LIMIT 50;
```

Each transition is also one info line, `alert event recorded`, with the server id, the kind, the subject and the
transition (never a name or a secret). Events are kept **90 days** (purged every 10 minutes in batches).

## Delivery to Discord (ADR-0027 PR 6)

Delivery is behind a **kill switch**: `ALERT_DELIVERY=on|off` in `backend/.env`, **default off** (anything else stops
the backend at startup). The startup log states the mode. While it is **off**, transitions are still recorded in the
alert log but **no outbox row is written and nothing is sent**; turning it on later sends **only transitions that
happen after that** (nothing was queued before). It needs `DATABASE_URL` and `SERVER_SECRETS_KEY` (the webhook is
stored encrypted), otherwise `on` is a startup error.

Turning it on, in order:

1. Deploy with `npm run db:migrate -w backend` first (adds `alerts.destinations` and `alerts.outbox`,
   `1790726400000_alert_delivery`). Keep `ALERT_DELIVERY=off` for the shadow run and read the alert log.
2. Set the server's webhook (until the rules API exists): `npm run admin -- set-alert-webhook <server-id>`, then paste
   the Discord webhook URL on stdin (it is read from stdin, never an argument, so it is not in shell history). It is
   validated (only `https://discord.com/api/webhooks/<id>/<token>`, or `discordapp.com`; no port, query, userinfo or
   subdomain), stored encrypted, and only its last 4 characters are printed. Running it again replaces the webhook and
   re-enables a disabled destination.
3. Set `ALERT_DELIVERY=on` and restart. The sender runs every 10 seconds.

How it delivers: the outbox row is written in the SAME transaction as the alert event (one row per event and enabled
destination; `(event, destination)` is unique). The sender claims due rows with `FOR UPDATE SKIP LOCKED` (two senders
never take the same row) and leases them for 2 minutes, so a crash mid-send means the message is sent again
(**at-least-once**). Failures retry with exponential backoff from 30 seconds up to 30 minutes, never sooner than a 429's
`retry_after`; a row still failing after **24 hours** is given up (`dead`). A **404** (webhook deleted) or **401** is
first retried about a minute later (one glitch must not kill a working destination); a repeat disables the destination
and gives up on its pending rows. Deleted servers are never delivered to. A 400 gives up on that message only; **redirects are never
followed**. The message text escapes game names so nothing can ping (`allowed_mentions` is empty); the unreachable alert
says "Game server or FRM not responding".

Per-server limits (#515, ADR-0045 M12), so one server, honest or forged, cannot crowd out the others:

| Limit | Value | Where | Past it |
|---|---|---|---|
| Circuits one power rule (`power_outage`, `fuse_trip`) tracks | 64 (lowest ids first) | `MAX_CIRCUIT_SUBJECTS_PER_RULE`, `serverAlertEvaluator.ts` | further circuits get no alert until a tracked one is gone; a gone circuit is forgotten once it is ok again |
| Alert events per server in any hour | 120 (one per 30 s evaluator tick) | `MAX_ALERT_EVENTS_PER_SERVER_PER_HOUR`, `alertEvaluatorWorker.ts` | `server_unreachable`, `agent_offline` and every `resolved` always go through; the room left goes to `fired`, then `updated`, then `renotify`. A `fired` with no room is not stored and its alert stays pending, so it fires once there is room (no silent firing alert, no orphan resolve); a dropped reminder is just skipped. Log `ALERT_EVENT_QUOTA_EXCEEDED` once an hour per server, metric `satis.alerts.events_dropped{server}` |
| Outbox claim | fair: every due server's oldest row before any server's second, 10 a tick | `CLAIM_DUE`, `deliveryRepository.ts` | a flooded server's backlog waits behind the others; within a server the order is unchanged |

A real factory is far under all three (the measured tier-6 save has one circuit). If a server keeps hitting the event cap,
look at its alert log: a forged or broken agent shows as many circuits flapping at once.

Security: the webhook URL is a bearer secret. It is sealed with AES-256-GCM (`platform/secrets`, bound to the server so a
copied value does not open), re-validated against the allowlist right before every send, and never logged, returned or
put in an error: logs carry only stable codes (`ALERT_DESTINATION_DISABLED`, `ALERT_DESTINATION_UNREADABLE`). Rotate it by
running `set-alert-webhook` again after creating a new webhook in Discord. Two cautions: a URL pasted at the prompt is
echoed by the terminal (clear the screen afterwards, or pipe it in), and do not set `NODE_USE_ENV_PROXY` on the backend
(it would route the send through a proxy that then sees the URL).

To stop sending at once: set `ALERT_DELIVERY=off` and restart (rows already queued wait in the outbox and are sent if
you turn it back on within 24 hours, then given up).

## Web push (ADR-0044, #348 task 348-2)

Push is a second channel through the **same outbox and the same sender**. It is on only when all of these hold:
`ALERT_DELIVERY=on` (the same kill switch: off stops push too), `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` and
`VAPID_SUBJECT` set, and `SERVER_SECRETS_KEY` present. `GET /api/push/config` says `enabled: true` only then. The service
worker and the opt-in UI are task 348-3; until it ships, subscriptions come only from a hand-made client.

- **Who gets a message (fan-out).** When an alert event is written, the same transaction adds one outbox row per
  subscription of every user who is **a current member of the server, active (`identity.users.status = 'active'`) and
  opted in** for it (`alerts.push_optins`). `(event, subscription)` is unique.
- **Send-time recheck.** Just before each push the sender checks again: still a member, still active, still opted in. If
  not, the row is dropped (`dead`, `last_error` = `recipient_not_member`, `recipient_user_inactive` or
  `recipient_opted_out`) and nothing is sent, so a removed member or an account disabled with
  `npm run admin -- disable-user` (#516) gets no alert content. The endpoint is checked against `PUSH_ENDPOINT_HOSTS`
  again too; one that no longer passes is dropped as `endpoint_refused` and never fetched.
- **What may go in `PUSH_ENDPOINT_HOSTS`.** Only hosts and zones that the push vendor fully controls (the defaults are
  Google's, Mozilla's and Microsoft's). **Never a shared zone** where anyone can claim a subdomain, such as
  `*.github.io`, `*.herokuapp.com` or a dynamic-DNS suffix: a stranger could subscribe with a host there that points at a
  private address, and the backend would POST to it. The allowlist is the SSRF guard; there is no address check behind it.
- **What is sent.** JSON of at most 3 KB: `{ v, title, body, serverId, kind, transition, severity, at }`, with the same
  words as the Discord message (title, server name, detail lines), game text cleaned as plain text (no control, bidi or
  invisible characters, length cut). It is encrypted per RFC 8291 (`aes128gcm`) and signed with VAPID (RFC 8292, ES256,
  token valid 12 h), both on `node:crypto`. Headers: `TTL: 14400` (4 h), `Urgency: high` for a critical alert firing,
  `normal` otherwise. 5 s timeout; redirects are never followed. The VAPID public key must be the private key's own
  (checked at startup: a mismatch stops the backend naming `VAPID_PUBLIC_KEY`, never a value).
- **Responses.** 2xx sent (and the subscription's `last_success_at` is set). **404 or 410 deletes the subscription**
  (its queued rows go with it) and writes an `alerts.push.subscription_gone` audit row (ids and the status only). 429
  (honouring `Retry-After`), 5xx, a timeout or a network error retry with the same backoff as Discord (30 s doubling to
  30 min, given up after 24 h); after a 429, a timeout or a network error that push service's HOST is skipped for the
  rest of the tick (its other rows are handed back, due now, without counting an attempt). Any other answer drops that row: `redirect_refused`, `vapid_rejected` (401/403: the
  VAPID keys changed, or the subscription was made for other keys), `bad_request`, `too_large`, `unexpected_status`.
  Keys a browser could not have made (not a P-256 point) are `bad_keys`, without a request.
- **Fairness and volume (#515).** Push rows share the claim's per-server turns with Discord rows (a row's server is its
  event's server), so a server with many subscribers gets no more of each batch of 10 than a server with one webhook.
  Within a server, its due Discord rows go before its push rows (each channel keeps event order), so a large fan-out
  never delays that server's next Discord message. A tick stops starting sends after 60 s (half the 2-minute lease) and
  hands the rest back, so a second backend process never re-claims a row this one may still be sending.
  The hourly event cap bounds what one server can queue: at most 120 events an hour, each times the number of opted-in
  devices (10 a user at most). If push lag grows, measure outbox lag first (ADR-0044 "Revisit when").
- **The test button.** `POST /api/push/subscriptions/:id/test` sends one fixed notification (no game text) and answers
  `{ ok: true }` or `{ ok: false, code }`: `subscription_gone` (it was deleted), `rate_limited`, `unavailable` (5xx,
  timeout, network), `rejected`, `secret_unreadable`. Still 5 a minute per user, audited as `alerts.push.tested`.

Counting drops: the metric `satis.alerts.push.dropped{server, reason}` (reasons `not_member`, `user_inactive`,
`opted_out`, `endpoint_refused`, `gone`, `rejected`, `expired`, `unreadable`, `push_disabled`), or in SQL:
`SELECT last_error, count(*) FROM alerts.outbox WHERE push_subscription_id IS NOT NULL AND status = 'dead' GROUP BY 1`.
Logs carry the server's public id, the alert kind, `channel: "push"` and a code; **never the endpoint, its host, a key,
the payload or the user**. `ALERT_PUSH_SUBSCRIPTION_UNREADABLE` means a subscription's sealed fields cannot be opened
(the key changed); the row is retried like a Discord webhook that cannot be opened.

Rotating the VAPID keys invalidates every subscription: the push services then answer 401/403 (`vapid_rejected`) or
404/410, and users must subscribe again. Rotate only on compromise (ADR-0044 decision 4).

## The alerts API (ADR-0027 PR 7b)

Thirteen routes under `/api/servers/:serverId/alerts/...` (the contract is `packages/shared/src/alerts.ts`; the sessions
that build the UI read the fixtures). **Every GET is for any member of the server; every other method, `POST .../test`
included, is owner/admin only** (the same membership check as every scoped route: a non-member gets the same 404 as an
unknown server, a viewer's write is a 403). It needs the database: without one the routes are not mounted.

- **Rules.** `GET /rules` lists the presets and the opt-in rules. `POST /rules` creates only `production_below_target`
  (`rule_kind_not_creatable` otherwise), at most **50 rules per server** (presets included) and **one per item**; both
  are `bad_request`, and the server's row is locked while a rule is created, so two requests cannot race past either.
  `PATCH /rules/:ruleId` changes `enabled`, `severity`, the three durations and the params that are meant to be tuned
  (the target and the window; a preset's own params); **`item` is immutable** (`rule_item_immutable`: to watch another
  item, create a new rule). A change keeps the persisted state; the engine's rolling window restarts if the window
  size changes. `DELETE` removes a non-preset rule and its states; **a preset can only be disabled**
  (`preset_disable_only`). A rule id from another server is `rule_not_found` on every route.
- **The Discord destination.** `PUT .../destinations/discord` takes `{ webhookUrl }` (the only place the URL ever
  appears): it is validated by the allowlist (`webhook_invalid`, with a `reason` such as `host_not_allowed`, never the
  URL), sealed, and re-enables the destination. `GET` returns only the last 4 characters and the state. `PATCH
  { enabled }` switches it (off = reason `manual`, and its pending deliveries are given up); `DELETE` removes it.
  `POST .../test` sends one message: **5 per minute per user** (429 `rate_limited`), `delivery_off` (409) while
  `ALERT_DELIVERY` is off, `destination_not_configured` (404), and otherwise `{ ok, code }` from the sender.
- **The log, status and mute.** `GET /events?limit=&before=` pages newest first (`nextBefore` is the id to pass as
  `before`; the cursor is at most 18 digits). `GET /status` is cheap to poll (the bell): `deliveryEnabled`, `mutedUntil`
  and the firing alerts of enabled rules, from persisted state, no history reads. `PUT /mute { until }` must be in the
  future and at most 7 days ahead (`mute_invalid`); `DELETE /mute` clears it.
- **Audit.** Every write records an audit event in the same transaction: `alerts.rule.created`, `.updated`, `.deleted`,
  `alerts.destination.set`, `.updated`, `.removed`, `.tested`, and `alerts.muted`, `alerts.unmuted`. The detail is ids
  and codes only (rule id, kind, item class name, the names of the changed fields), **never the webhook URL or any part
  of it**. A body that fails its schema is answered with a fixed message, and no request body is logged.
- **Roles for the UI.** `GET /api/servers` now carries each server's `role` (owner, admin or viewer) for the signed-in
  user, a hint so the frontend can hide edit controls; the 403 on writes is the real control.

## Known limits

- **"Unreachable" is the joint status + power fetch.** If only FRM (power) is down while the game's own API answers,
  `server_unreachable` can fire; the message says the server, not which API.
- **A hard-deleted preset comes back** after a restart (seeding is idempotent and per process). Disable a rule with
  `enabled = false` instead of deleting it.
- **One server's failing write does not stop the others**: each server is evaluated on its own, the purge still runs,
  and the tick is then reported as failed (one warning per outage).

## When something looks wrong

- Warning `alert evaluation failed; skipping the tick with no state change`: the database refused something. Logged
  once per outage, and `alert evaluation recovered` follows.
- Warning with `code: ALERT_RULE_UNREADABLE`: a rule's params in `alerts.rules` do not match its kind's schema (edited
  by hand). It is skipped, once logged, and the other rules keep working.
- A removed server loses its rules, states, events and mute with it (so a revived id starts clean).

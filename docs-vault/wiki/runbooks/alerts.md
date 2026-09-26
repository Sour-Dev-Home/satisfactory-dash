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
| `fuse_trip` | **no** | one per circuit | `fuseTriggered` | 0 / 60 s / 1 h | critical |

`fuse_trip` exists but is not seeded: today "outage" IS a tripped fuse, so both would say the same thing twice.
"Newly underfed" is not offered (ADR-0027 amendment 2) and "production below target" is undecided.

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
`retry_after`; a row still failing after **24 hours** is given up (`dead`). A **404** (webhook deleted) or **401**
disables the destination and gives up on its pending rows; a 400 gives up on that message only; **redirects are never
followed**. The message text escapes game names so nothing can ping (`allowed_mentions` is empty); the unreachable alert
says "Game server or FRM not responding".

Security: the webhook URL is a bearer secret. It is sealed with AES-256-GCM (`platform/secrets`, bound to the server so a
copied value does not open), re-validated against the allowlist right before every send, and never logged, returned or
put in an error: logs carry only stable codes (`ALERT_DESTINATION_DISABLED`, `ALERT_DESTINATION_UNREADABLE`). Rotate it by
running `set-alert-webhook` again after creating a new webhook in Discord.

To stop sending at once: set `ALERT_DELIVERY=off` and restart (rows already queued wait in the outbox and are sent if
you turn it back on within 24 hours, then given up).

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

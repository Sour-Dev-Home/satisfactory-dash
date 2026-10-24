# Runbook: edge agents (ADR-0031 PR 5a and 5b)

The backend side of the edge agent. The agent program itself is a later PR (ADR-0031 PR 6); this page covers what the
backend does today, so the pieces can be tried with a hand-made client and operated once the agent exists.

## Deploy order

1. `npm run db:migrate` **first**: PR 5a adds the `agents` schema (`enrollment_codes`, `agent_credentials`), PR 5b adds
   `agents.commands` and lets `alerts.rules.kind` be `agent_offline`. Both are additive; the previous build keeps working
   on the new schema. The backend refuses to start on a schema older than its own (`assertSchemaCurrent`).
2. Deploy the backend. Nothing needs configuring: the agent API is at `/agent/v1` (outside `/api`), the owner's routes
   under `/api/servers/:serverId/agent`.

## What is stored

| Table | Holds | Kept |
|---|---|---|
| `agents.enrollment_codes` | the SHA-256 of a one-time code, its server, expiry, whether it was spent | until spent, expired or replaced; a new code drops the server's unspent ones |
| `agents.agent_credentials` | the SHA-256 of the agent's secret, its reported version, when it was last heard, whether it was revoked | one row per enrolled server |
| `agents.commands` | what the dashboard asked the agent to do (today: set auto-pause, as a boolean), its status and result **code** | 60 s to run; finished ones are purged after 7 days |

The agent's secret and a code are never stored or logged in clear. A removed server's rows go with it.

## Enrolling, and what enrolling does to a local server

`POST /api/servers/:serverId/agent/enrollment-codes` (owner or admin) makes a code `XXXX-XXXX-XXXX` (12 base32
characters, 60 bits; #524, ADR-0046 section 4), valid for 10 minutes, single use. **For a server this backend reaches directly (`local`), only the operator can create one**, because
enrolling deletes the server's stored game-server tokens and makes it an `agent` server (its pollers stop). Saving a
local connection also drops that server's unspent codes.

**Code format change (#524): an already-enrolled agent keeps working, but re-enrolling needs an agent build with this
change.** Enrolment is the only place a code is used, and an agent's credential is a separate secret, so nothing
enrolled stops. But the agent checks the code's shape locally before it sends anything, so an older build rejects a
12-character code ("Usage: agent enroll ...") and never reaches the backend; the backend in turn rejects the old
8-character form with a 400. Update the agent (and the mod, which pins the same format) before the next enrolment or
re-enrolment of any server.

## Revoking, and the way back

`DELETE /api/servers/:serverId/agent` stops the agent's credential at once (it gets 401) and drops any unspent code.

**After a revoke the server stays an `agent` server with no data until an agent is enrolled again.** Its live routes
answer `upstream_unreachable` once the last snapshot is stale, its auto-pause can no longer be changed (`not_editable`),
and it stays that way until you either create a new enrollment code and enrol an agent, or switch the server back to
`local` with `POST /api/servers/:serverId/local-connection` ([`servers.md`](./servers.md), ADR-0031 amendment 2).

## Self-serve servers (ADR-0046, #525): shipped dark

`POST /api/servers/agent` with `{ "displayName": "..." }` lets any signed-in, active account create an agent server of
its own, without the operator. The backend picks the id (20 random base32 characters); the server is born `agent`, with
no host, no tokens and no connection test, and the caller is its owner. The owner then makes a code with the usual
`POST /api/servers/:serverId/agent/enrollment-codes` and puts it in the agent or the mod. In the database the server is
`servers.servers.created_via = 'self_serve'` (everything else is `operator`), and a trigger refuses to commit a
self-serve server that has no owner. `npm run admin -- list-servers` shows `via=operator` or `via=self_serve`. The
operator's managed list (`GET /api/servers/managed`) shows operator-created agent servers only, since the operator is not
a member of a self-serve one.

**It is off until you turn it on.** Off, the route answers 403 `forbidden` for everyone and nothing else changes.

| Setting (`backend/.env`, on AWS the task definition) | Cap | Default | Bounds | Refusal |
|---|---|---|---|---|
| `SELF_SERVE_ENABLED` | the kill switch | `false` | `true` or `false` | 403 `forbidden` |
| `SELF_SERVE_MAX_SERVERS_PER_ACCOUNT` | C1, live self-serve servers one account created | 2 | 1 to 20 | 409 `server_limit_reached` |
| `SELF_SERVE_MAX_PENDING_PER_ACCOUNT` | C3, of those, never enrolled (no credential row, ever) | 1 | 1 to C1 | 409 `server_limit_reached`, naming the pending server |
| `SELF_SERVE_MAX_SERVERS_TOTAL` | C2, live self-serve servers in total | 25 | 1 to 1000, at least C1 | 409 `server_limit_reached`, "the service is full" |
| `SELF_SERVE_CREATES_PER_DAY` | C5, creations per account in any 24 h, removed servers included | 5 | 1 to 100 | 429 `rate_limited` with `Retry-After` |
| `SELF_SERVE_PENDING_TTL_HOURS` | C4, hours a self-serve server may stay never-enrolled before the sweep removes it | 24 | 1 to 168 | (none: the server is removed) |

The caps count self-serve servers only, and the operator's account is exempt from all of them. All are checked under
the server-management advisory lock in the create transaction, so concurrent creates cannot pass one together. **C1, C3
and C5 count by creator** (`servers.servers.created_by_user_id`, #526), not by current owner, so handing a server to
another account never frees a slot. C5 counts the rows the account created in the last 24 hours, live or removed, so a
restart does not reset it and create-and-remove churn is counted; a refused create writes no row and is not counted. Only
the operator changes a setting, by editing it and restarting the backend; there is no API. A bad value stops the backend
at startup, naming the variable. Lowering a cap never deletes a server; it only refuses new creates.

**The owner may rename and remove their self-serve server** (#526, ADR-0046 section 1.8): `PATCH
/api/servers/:serverId/name` and `DELETE /api/servers/:serverId`, the routes the operator uses for agent servers. Who gets
what:

| Caller | Self-serve server | Operator-created server |
|---|---|---|
| its owner | 200 | 403 `forbidden` (operator only, as before) |
| an admin or viewer of it | 403 `forbidden` | 403 `forbidden` |
| not a member (the operator included) | 404, as for an unknown server | 404 |
| the operator, as a member | as above for their role | unchanged (the operator-only routes as before) |

Ownership and `created_via` are re-checked under the server's row lock in the same transaction as the change. A remove is
the same purge as `remove-server` (`abuse-response.md`, step 2): the agent's credential and any unspent code go (the agent
gets 401), and so do the members, history, alerts and map; the runtime entry is dropped at once, so no restart is needed.
It writes `server.deleted` with the owner's user id and `detail: { reason: "owner_removed" }`; a rename writes
`server.updated` with `detail: { fields: ["displayName"] }`. A removed self-serve id is never handed out again: the create
is a plain INSERT, so the same id is a unique violation. **Rename and remove keep working while `SELF_SERVE_ENABLED=false`**
(intended: the switch stops new servers, and an owner can always delete their data).

A self-serve server is agent-only: the operator's `POST /api/servers/:serverId/local-connection` refuses it with 403
`forbidden`. The owner's rename and remove, the sweep and the operator's management writes take one shared in-process
lock, so their runtime changes never interleave, and every runtime entry added after a commit (a create, an enrolment,
a first snapshot) is checked against the database again and dropped if the server was removed meanwhile.

**The pending sweep (C4).** Every 10 minutes, the backend removes up to 50 self-serve servers (oldest first) that are
older than `SELF_SERVE_PENDING_TTL_HOURS` and have no `agents.agent_credentials` row. A server that ever enrolled, even
with a revoked credential, is never swept, and operator-created servers are never candidates. Each removal locks the
server row and checks enrolment again in its own transaction (an enrolment in flight wins), then runs the same purge,
writing `server.deleted` with no actor and `detail: { reason: "never_enrolled" }`. It runs whether or not
`SELF_SERVE_ENABLED` is on, so turning creation off does not strand pending servers. The log line `removed self-serve
servers that never enrolled` carries `{ swept, skipped }`, and the counter `satis.servers.pending_swept` (no labels) adds
the number swept; counts only, never an id or a name. A steady rate of sweeps means accounts create servers they never
connect (ADR-0045 M3's residual): look at `list-servers`.

**To turn it on** (only once every ADR-0046 release gate in section 7 is closed and the owner says go):
1. `npm run db:migrate` (the `created_via` column and the trigger, `1791590400000_self_serve_servers`; the creator
   column and its index, `1791676800000_self_serve_creator`).
2. Set `SELF_SERVE_ENABLED=true` in `backend/.env` (it needs `DATABASE_URL`) and, if needed, the caps above.
3. Restart the backend. The startup log says `self-serve server creation is ON`.

**To turn it off:** set `SELF_SERVE_ENABLED=false` (or remove it) and restart. Existing self-serve servers keep working;
abuse is handled with `npm run admin -- list-servers`, `disable-user` and `remove-server` (`abuse-response.md`).

## Commands

The dashboard cannot reach into a player's network, so the auto-pause change of an agent server is a **command**:
`PUT /settings/auto-pause` answers `202` with the command, the agent fetches it with `GET /agent/v1/commands` (a
long-poll of up to 25 s that is answered the moment a command exists), runs it and reports a result **code**
(`POST /agent/v1/commands/:id/result`; never free text). The dashboard follows it with `GET
/api/servers/:serverId/commands/:commandId`. A command left unanswered for 60 s is `expired` and must not be run; a
server can have at most 5 open commands. A `local` server still answers `200` with the new setting.

**Rule for command types (architect, 2026-09-26): commands must be idempotent, and the agent de-duplicates by id.** A
command that the agent has received but not yet reported (`sent`) is handed out again on every poll until it is reported
or expires (60 s), so an agent that restarts before reporting still gets it. Therefore every command type must be
idempotent (`set_auto_pause { enabled }` is), and the agent app (ADR-0031 PR 6) must remember the ids it has run until their
`expiresAt`, so it never executes one twice. A future command type that is not idempotent needs an explicit claim step
in the backend first.

Reading the setting of an agent server (`GET /settings`) gives, in this order: the value **being applied** (a waiting
command, with `pending`); else the **newer** of the last confirmed change and the agent's latest reading. The reading is
`settings.autoPause` in a snapshot: the agent sends it whenever it read the setting in that snapshot (each status
cadence), never on an unreachable snapshot. A reading taken after the last confirmed change shows an edit made in the
game since; one taken before it is out of date. While the game is unreachable the last reading is kept, and the envelope's
`observedAt` is its time and `stale` is true once it is older than three status intervals. With neither a reading nor a
confirmed change (an agent that sends no `settings`) the value is unknown and the read answers `upstream_unreachable`.
A deferred change (the game accepted it, but it waits in `PendingServerOptions`) is **not a failure**: the agent reports
the command `ok` (there is no new result code; the code enum stays closed) and sends `settings.pending: true` next to
`settings.autoPause` (the new value). `GET /settings` then answers `pending: true` while the latest reading says so, as it
does while a command waits. `pending` is optional: absent means not pending, so an older agent or mod is unchanged.
Restarting the backend forgets the reading until the next snapshot.

## What the agent sends, and what the backend derives (ADR-0031)

A snapshot carries raw readings only. `power` has no circuit `status` and no `hasOutage`; `factory` has no machine
`state`, no `stateCounts`, no `backedUpCount`, and its rates have no `unit` (`isBackedUp` stays: it is a raw fact that
needs the output inventory, which only the agent sees). The backend derives all of them at ingest
(`telemetry/services/snapshotDerive.ts`) with the same rules a polled server uses, so a rule change never needs an agent
update. A field an agent still sends is dropped by the schema and, as a second guard, never copied by the derivation.
A machine's fuse is joined from the latest power reading by circuit; if that reading is older than three power
intervals (or none arrived) the fuse is unknown and the machine gets no `state`, never a guess. A stored factory keeps
the states derived from the fuses known when it arrived, so a fuse that trips afterwards shows on machines at the next
factory snapshot (30 s by default), not at once.

**Input bounds** (the contract every agent is held to; the backend REFUSES a body that breaks one with a 400, it never
clamps): strings at most 200 characters (matching the history tables' CHECKs, since an over-long class name would fail a
whole batch insert); at most 20,000 buildings, 1,000 circuits, 16 rates per building and 256 players; every number
finite; MW, rates and clock speed `>= 0`; battery percent 0 to 100. The agent clamps float noise (a battery at
100.0000001) before it sends. The response schemas have no such bounds.

Still the agent's word, by design (it is the only source of these readings): `isBackedUp`, `isPaused`, `isProducing`,
`circuitGroupId`, each circuit's `fuseTriggered` and the numbers. A compromised agent can therefore cause an outage,
`backedUp` or `unpowered` state and the alerts that follow, but only for its own server. Body size is capped (5 MB) and
each credential is rate limited, which bounds what one agent can make the backend hold. What a snapshot may add to
history and alerts is capped per server below the input bounds (#515): see `history.md` and `alerts.md`.

## Limits on the agent API (#514, ADR-0045)

All in process, per backend instance (`backend/src/modules/agents/config.ts`; token buckets in
`platform/tokenBucket.ts`). The agent API and the world-layer routes share one `createAgentAuth` instance (#562), so the
failure and lookup budgets below cover both together. Every refusal is the usual 429 `rate_limited` with `Retry-After` (or 413 for an oversized
body), which the agent honours and retries.

| Limit | Key | Size | Why |
|---|---|---|---|
| Snapshots | credential | 150 at once, then 0.6 a second (3 per 5 s tick) | one snapshot per 5 s tick; the agent queues up to 120 during an outage and sends them back to back |
| Snapshot bytes (decompressed) | credential | 32 MB at once, then 4 MB a minute | a real agent sends about 250 KB a minute (the factory read, about 100 KB, every 30 s); a credential in debt is refused before its next body is read, and a body that fails while being read (over the cap, corrupt gzip, abandoned midway) is charged the cap |
| Snapshot uploads in flight | credential | 1 | the agent posts one at a time; without this, concurrent uploads would all pass the byte check at once |
| Lookups of a recently valid credential | credential hash | 50 at once, then 10 a second | across every agent route, checked before the database lookup, so an owner can't flood the lookup query with their own credential |
| One snapshot | request | 5 MB decompressed (413) | about 440 bytes a building, so about 11,000 buildings |
| Command polls and results | credential | 30 at once, then 1 every 2 s | the agent long-polls for up to 25 s |
| Open long-polls | credential | 1 | a new `GET /commands` ends the open one, which answers an empty list |
| Failed authentications | client network (IPv6 /64) | 60 a minute | a missing, malformed, unknown or revoked credential |
| Failed authentications | whole process | 6,000 a minute | a flood from many addresses costs at most this many lookups |
| World layers | credential | 20 per 10 minutes, 2 MB each | `map/routes/agentWorldRoutes.ts` |
| Enrolment | client network / process | 10 / 1,200 a minute (was 120 before #524) | `ENROLL_*` in `agents/config.ts`, used by `agents/routes/agentApi.ts`; the guess arithmetic is by the constant |
| Enrolment codes created (#527, ADR-0046 C7) | account | 10 a minute and 20 an hour (both apply) | bounds enrolment churn and its audit rows; a setup needs 1 to 3 codes. The hourly cap is `ENROLLMENT_CODES_PER_HOUR` (whole number 1 to 1000, default 20; a bad value stops the backend at startup). A fixed window from the account's first code, in memory per instance, so a restart resets it. The operator's account is exempt from the hourly cap (bulk re-enrolment after a restore) but not the minute one. A refusal is the usual 429 `rate_limited` with `Retry-After`, and says "this hour" |

Successful authentications never count against the failure budgets, and a credential that authenticated in the last
15 minutes skips them entirely (it is still looked up every time, so a revocation is immediate). A flood of junk
therefore never refuses a working agent. One that hasn't authenticated for 15 minutes (or since a backend restart) can
be refused while a flood is using up the global budget, and gets in once the minute's window ends.

Known leftover risks (accepted for now, #514 security review):
- **A backend restart during a flood refuses every agent** until the flood's minute window ends: the recently valid
  list is in memory, so after a restart no credential is known yet, and each one needs a slot in the global failure
  budget for its first lookup.
- **An IPv6 /48 holder can still fill the global failure budget**: a /48 is about 65,000 /64 networks, and about 100 of
  them at 60 failures a minute use up the 6,000. Valid agents that are already known are not affected; new or
  restarted ones are, as above. Edge rate limiting (ADR-0045 E4) is the answer if `satis.agent.refused` shows it.

`satis.agent.refused` (a counter, labels `server` = public id or `unknown` before authentication, and `status` =
400, 401, 413, 415 or 429) shows which server is refused, and how. Sustained 401s or 429s under `unknown` from many
addresses is ADR-0045 E4's trigger to revisit edge rate limiting.

## Agent offline (alert)

`agent_offline` is a preset **only for agent servers** (seeded on the alert engine's next tick after a server becomes
one): no snapshot of any kind for 2 minutes (`offlineSeconds`, at least 60), critical, 0 s / 60 s / 1 h. Silence is
measured from the later of the last snapshot and the backend's own start, so after a restart an agent that is gone is
noticed 2 minutes later. It speaks through a paused game and an unreachable game server. It is subject to the same
kill switch (`ALERT_DELIVERY`, default off) and the shadow week as every alert (see `alerts.md`).

## Reading what happened

The audit trail has `agent.enrollment_code_created`, `agent.enrolled`, `agent.revoked`, `agent.command.created`,
`agent.command.succeeded` and `agent.command.failed` (ids and codes only). The request log lines carry `appMs` and
`upstreamMs` (ADR-0032), and no snapshot, code, secret or player name is ever logged.

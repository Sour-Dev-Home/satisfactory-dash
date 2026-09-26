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

`POST /api/servers/:serverId/agent/enrollment-codes` (owner or admin) makes a code `XXXX-XXXX`, valid for 10 minutes,
single use. **For a server this backend reaches directly (`local`), only the operator can create one**, because
enrolling deletes the server's stored game-server tokens and makes it an `agent` server (its pollers stop). Saving a
local connection also drops that server's unspent codes.

## Revoking, and the way back

`DELETE /api/servers/:serverId/agent` stops the agent's credential at once (it gets 401) and drops any unspent code.

**After a revoke the server stays an `agent` server with no data until an agent is enrolled again.** Its live routes
answer `upstream_unreachable` once the last snapshot is stale, its auto-pause can no longer be changed (`not_editable`),
and there is no "switch back to local" action yet (it is a Backlog card). The only way back is to create a new
enrollment code and enrol an agent.

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

Reading the setting of an agent server (`GET /settings`) gives the last value the agent **confirmed** (or the one
being applied, with `pending`). The agent's snapshot has no auto-pause field, so before the first confirmed change the
value is unknown and the read answers `upstream_unreachable`. Adding the field to the snapshot is a contract change for a
later PR.

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

# ADR-0031: The edge agent (the game PC connects out; the backend never reaches in)

Status: accepted (owner, 2026-09-26: as drafted; "agent offline" is a default preset, on after the
shadow week; runs from the repo checkout until the first other player; the auto-pause toggle shows
"Saving…" until the agent confirms)

## Context
- Today the backend runs beside the game and calls it over loopback: live routes (`status`, `power`,
  `factory`, `players`, `settings`) call the game adapter per request, and background pollers feed
  history (ADR-0027) and the alert `ObservationBoard`. The adapter lives in
  `backend/src/modules/gameserver/` (vanilla HTTPS client, FRM HTTP client, raw zod schemas).
- ADR-0034 moves the backend to AWS, agent first. ADR-0020 already fixed the agent's shape: an
  enrollment code, a per-server agent credential, snapshot push over HTTPS, commands by long-poll,
  settings writes as `202` + a command. ADR-0030's `agent` connection kind is reserved for this.
- The game's API token is admin-level and FRM is plain HTTP, so neither may leave the game PC.

## Decision
### 1. What the agent is
- A small Node.js/TypeScript program in a new workspace `agent/`, running on the game PC. It reads
  the game over loopback with the **same adapter the backend uses today**, and pushes normalized
  snapshots to `https://api.satis-manager.com/agent/v1/*`. It holds the game tokens locally. The
  cloud never sees them.
- The adapter moves from `backend/src/modules/gameserver/` into a package `packages/game-adapter/`,
  used by the agent and, for local development and self-hosting, by the backend. Behaviour doesn't
  change: same raw schemas, same mapping, same tests.
- Normalization happens in the agent (contract shapes: status, power circuits, factory buildings,
  players). **Classification stays in the backend** (`classifyBuilding`, backed-up, underfed), so a
  rule change never needs an agent update.

### 2. Protocol (schemas in `packages/shared`, versioned `v1`)
- `POST /agent/v1/enroll` with a single-use enrollment code (10 minutes, consumed atomically; ADR-0020)
  returns a 256-bit agent secret, shown to the agent only. The database stores its SHA-256 hash
  (high entropy, so a fast hash is correct). One credential per server. Revoke and re-enroll replace
  it.
- `POST /agent/v1/snapshots` (Bearer secret): `{ agentVersion, observedAt, reachable, paused,
  status?, power?, factory?, players? }`, gzip-encoded. The server stamps `receivedAt` and trusts the
  agent's `observedAt` only within ±60 s of it (else uses `receivedAt`). The backend alone decides
  `stale` from snapshot age (as the envelope already does).
- `GET /agent/v1/commands` long-poll (25 s, under Cloudflare's timeout) returns pending commands for
  that server. `POST /agent/v1/commands/:id/result` reports success or failure. Commands expire after
  60 s.
- The response to each snapshot carries the cadence the agent should use, so cadence changes are
  server-side. Now: power and status every 5 s, factory every 30 s (today's poller rates, which history
  and alerts rely on). Viewer-driven cadence (ADR-0020) waits for phase 2 scale.
- The credential binds the agent to exactly one `server_id`. Agent routes accept no user session,
  have their own rate limit and body-size limit (factory payloads compressed), validate strictly
  with zod, and never log payloads (player names stay unlogged: ADR-0029's redaction applies to
  ingest).

### 3. Backend side
- Ingest publishes each snapshot to the same seams the pollers use: the `ObservationBoard` (alerts),
  the history recorder (skipping paused and unreachable, as today), and a latest-snapshot store the
  live routes read. **Live routes stop calling the game per request** and serve the latest snapshot
  with its age. That's the "request path reads snapshots" pattern.
- The latest-snapshot store is in memory (one instance). The trigger for a Postgres
  `latest_snapshots` upsert (ADR-0020) is a second backend instance.
- A new alert kind, **agent offline**: no snapshot for 2 minutes. On AWS this also detects the PC
  being off, which only the external monitor could see before. Default preset on, grouped with the
  existing suppression rules.
- `local` servers keep polling in-process, for development and self-hosting. A server is either
  `local` or `agent`, never both.

### 4. Settings writes become commands (a contract change, sequenced first)
- `PUT /api/servers/:id/settings/auto-pause` returns `202` + a command resource for every server
  kind. `local` completes it at once, `agent` when the agent reports. The frontend polls the command
  (or refetches settings) until it's done or expired. Because this breaks the contract, the frontend
  learns to accept both `200` and `202` before the backend switches.

### 5. Running it on the game PC
- The owner, now: run from the repo checkout (`npm run agent`) as a Windows Scheduled Task at logon
  or startup, with the same wrapper pattern as the backup task. The agent secret and the game tokens
  are stored with Windows DPAPI (current user), not in plain files.
- Resilience: exponential backoff with jitter on failure, a bounded in-memory queue (it drops the
  oldest snapshots, never grows without limit), and structured logs with rotation.
- Players (phase 2): a packaged single executable with signed releases and an update check. The
  trigger is the first player other than the owner.

## Build plan
| # | PR | Owner | Tier |
|---|---|---|---|
| 1 | This ADR (docs) | dev | skip |
| 2 | Extract `packages/game-adapter` (no behaviour change) | dev | QUICK |
| 3 | Contract: the agent protocol schemas + the settings command resource (additive: `202` optional) | dev | QUICK |
| 4 | Frontend accepts `200` or `202` + command for auto-pause | fe | QUICK + ui |
| 5 | Backend: enrollment codes, agent credentials, commands tables; agent auth; ingest into board, history and latest store; live routes read the latest snapshot; settings via commands; `agent_offline` kind | dev | FULL + security |
| 6 | `agent/` app: enroll CLI, DPAPI store, push loops, command long-poll, logs, Scheduled Task runbook | dev | FULL + security |
| 7 | UI: enroll (code shown once), agent status (last seen, version), revoke | fe | QUICK + ui |
| 8 | Switch the owner's server from `local` to `agent` on the PC. Run a week in parallel (compare history and alerts), then retire its `local` connection. | owner + dev | runbook |
Then ADR-0034's AWS build.

## Consequences
- The cloud stores no game tokens, and no inbound path to any game PC exists.
- Live views show the latest pushed data (up to 5–30 s old) instead of per-request reads, which also
  removes per-viewer load on the game.
- One more program to run on the PC, with its own logs and updates.

## Revisit when
- A second backend instance (the latest-snapshot store moves to Postgres; the evaluator needs a
  leader lock).
- The first other player (packaging, signed updates, viewer-driven cadence).

## Amendment 1 (2026-09-26, PR 5b): where the 202 applies
- The auto-pause PUT answers `202` + a command only for a server reached through an agent. A `local` server keeps answering `200` with the setting, so the frontend's `200` or `202` handling (PR 4) is what makes this safe, and turning `local` into `202` is not part of PR 5.
- Reading the auto-pause of an agent server returns the last value the agent confirmed (`pending` while a change is on its way). The snapshot has no auto-pause field yet, so before the first confirmed change the value is unknown (`upstream_unreachable`); adding the field is a contract change for a later PR.

## Amendment 2 (2026-09-26): Rollback: switch back to local
**Context.** Switching a server to an agent has no way back. Before the parity week the owner needs one: if the agent misbehaves, the backend must read the game server itself again.

**Decision.** `POST /api/servers/:serverId/local-connection` (operator only) turns an agent server into a `local` one, with the connection details in the request.
- The connection is tested BEFORE the mutex and the transaction, like create and update, so a slow game server never holds the lock. A server that is not an agent server answers `server_not_agent` (409).
- In one transaction: advisory lock, re-check the kind under the row lock, the server-count cap, flip the kind to `local` (first, because `createConnection` only inserts for a `local` server), save the connection, and release the agent side (unspent enrolment codes dropped, the credential revoked, pending and sent commands ended as the existing state `expired`; no new state or result code). The audit row `server.switched_to_local` carries counts, never secrets.
- After the commit, still under the management lock (so a concurrent removal or edit cannot interleave), the runtime removes and re-adds the server (`replace` refuses agent to polled by design), so polling starts without a restart.
- Ingest accepts snapshots only for `connection_kind = 'agent'`, so an old agent that keeps pushing is refused (`401`) once its credential is revoked and the kind has flipped.

**Consequences.**
- Memberships and history are kept: history keys on the internal server id, which does not change.
- Enrolment codes are dropped so an old code cannot re-enrol the server after the switch.
- Switching to the agent again later goes through the normal flow (a new code, a new credential).

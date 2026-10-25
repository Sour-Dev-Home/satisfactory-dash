# ADR-0052: The last snapshot survives an offline game and a backend restart

Status: **Accepted** (owner approved building both points, 2026-10-24). One wording choice on the privacy page is the
owner's to confirm before PR 2 merges (Decision 2.6). Amends ADR-0031 section 3 (the agent's latest-snapshot store) and
ADR-0004 (the envelope gains one optional field). A new ADR rather than a rewrite, per the decisions README.

Paths are under `backend/src/` unless they start with a top-level directory.

## Context

The owner's requirement: "Even if the server goes offline and the agent along with it the backend should still give
the frontend the latest snapshot (but do not hold onto any more snapshots than needed. Meant to be a cache not a full
database)".

How an agent-backed server answers today (`modules/telemetry/services/agentSnapshotStore.ts`):

- The store keeps one latest reading per part (status, power, factory, players), each with its own time (`:15-20`).
- **Agent silent:** reads keep serving the last parts, marked `stale` after three of their cadence intervals
  (`:142-146`). This already meets the requirement.
- **Agent says the game is unreachable:** `record()` keeps the parts (`:70`), but `read()` throws 503
  `upstream_unreachable` (`:128-130`), so the frontend loses the data it still has.
- **After a backend restart** (every deploy, ADR-0049) the store is empty and `read()` throws 503 "agent has not
  reported yet" (`:125-127`) until the agent's next snapshot.
- A request-through (local) server reads the game on each request (`modules/telemetry/index.ts:117-121`) and keeps
  nothing, so it also answers 503 when the game is down.
- The frontend says "Game server unreachable." once, from the status query's error (`frontend/src/components/StatusBanners.tsx:29`,
  `ErrorNotice.tsx:31-32`). Panels show a quiet empty state when both they and status are unreachable
  (`PanelError.tsx:30`). Stale data already gets a "Showing last known data" line (`StatusBanners.tsx:30-33`) and a
  late `DataAge` per panel (e.g. `power/PowerPanel.tsx:63`).

## Decision

### 1. An unreachable game still serves the last parts

1.1 **Contract (additive, ADR-0007).** `packages/shared/src/envelope.ts` gains one optional field next to `stale`:
`unreachableSince: z.iso.datetime().optional()`, described as "Set when the game server could not be reached at the
last attempt: when that started (UTC). Absent = reachable, or not known." When it is set, `stale` is always `true`. No
`offline` boolean: the timestamp carries the same fact and the banner can say since when.

1.2 **Agent store.** `record()` of an unreachable snapshot sets `unreachableSinceMs` to that snapshot's `observedAtMs`
only on the reachable-to-unreachable change (a run of unreachable snapshots keeps the first time). A reachable snapshot
clears it. `read()` no longer throws for `reachable === false` when the part exists: it returns the part with
`stale: true` and `unreachableSince`. `observed()` and `snapshot()` in `platform/snapshot.ts` carry the new optional
field the same way they carry `stale`. Still 503 `upstream_unreachable`: no part stored (never reported, or not yet
loaded), and an unreachable game with no stored part. The `fallback` path stays (an agent that never sent players).
An agent that is merely silent does not set `unreachableSince`: that remains "stale" only (see Deferred).

1.3 **Request-through parity.** In `createTelemetryServices` (`modules/telemetry/index.ts`), status, power, factory
and players are each wrapped in a small in-memory last-good decorator (`services/lastGood.ts`): a success replaces
the remembered response; an `ApiFailure` with code `upstream_unreachable` returns the remembered one through
`observed(...)` with `stale: true` and `unreachableSince` (the first failure in the run); no remembered response
rethrows. Other failures (auth rejected, invalid response, upstream_error) still throw: they are configuration or
contract faults, and hiding them behind old data would delay the fix. One value per part, memory only, never
persisted (request-through is the local and rollback mode, ADR-0031 Amendment 2).

1.4 **Log level (#615).** The rule in `platform/logLevel.ts:7,23` still applies unchanged to the 503s that remain.
Reads that now return 200 with old data log at `info` like any 200. No new rule.

1.5 **Frontend.** `StatusBanners` shows the same "Game server unreachable." notice when the status snapshot has
`unreachableSince`, in addition to its existing `ErrorNotice` path (still needed for the 503 cases in 1.2), with the
time ("since 14:05"). The "Showing last known data" line stays. Panels render their data as now, with `DataAge` late,
and a dimmed body while `unreachableSince` is set: a `data-stale` attribute styled by a new `--opacity-stale` token in
`frontend/src/index.css` (frontend design-token rule), with the existing ease-in-out transition. `PanelError` is
unchanged: with a 200 there is no panel error. Deploy order is safe: the frontend ships first (ADR-0049 "Backend lags
frontend") and handles the field being absent, and an old frontend against the new backend shows stale data without
the banner only until it reloads.

### 2. One row per server survives a restart

2.1 **Table.** `telemetry.latest_snapshots`, owned by the telemetry module (one schema per module, ADR-0014), created
by an expand-only migration (ADR-0049 D6: a new table only). One row per server, primary key `server_id` (FK to
`servers.servers`, `ON DELETE CASCADE`); columns: `reachable boolean`, `unreachable_since timestamptz NULL`,
`last_received_at timestamptz`, `status jsonb NULL`, `status_observed_at`, `power jsonb NULL`, `power_observed_at`,
`factory jsonb NULL`, `factory_observed_at`, `auto_pause boolean NULL`, `auto_pause_pending boolean NULL`,
`auto_pause_observed_at`, `updated_at`. Written with `INSERT ... ON CONFLICT (server_id) DO UPDATE`: no history, no
growth, the same pattern as `map.world_layers` (`backend/migrations/1791158400000_map_world_layers.sql`). History
stays in the ADR-0027 tables; the 5-minute power ring buffer (ADR-0022) is not restored.

2.2 **Players are never written.** The players part holds player names, and the privacy page promises they are
"Kept in memory, never written to the database or the logs" (`frontend/public/privacy.html:93-97`). There is no
players column. After a restart the players read 503s (or uses its fallback) until the agent's next report, about
5 s (`modules/agents/config.ts:5`).

2.3 **Write policy.** A `LatestSnapshotWriter` worker (in `workers`, like the history recorder) upserts the row:

- at most every **5 minutes** while anything changed since the last write (a part's `observedAt` moved or
  reachability changed); nothing changed, nothing written, so an offline server costs zero writes;
- at once on every reachability change (reachable to unreachable keeps the last good parts and the banner across a
  restart; unreachable to reachable stops a restart from bringing back a banner that is no longer true);
- once on `stop()` (graceful shutdown on a deploy), bounded by a 2 s timeout, best effort.

Why 5 minutes: the factory part changes every 30 s and is the large one (about 100 KB for a real factory,
`modules/agents/config.ts:26-30`). Writing it every 30 s is 2,880 upserts a server a day; 5 minutes is 288, and the
flush on shutdown means a normal deploy loses nothing. A crash loses at most 5 minutes, and the restored data is
served as stale anyway. A write failure logs at `warn` and is retried at the next tick; it never fails ingest.

2.4 **Load on startup.** `createAgentTelemetryServices` loads the row once per server. `read()` waits for that load
(bounded at 2 s, then treats the store as empty). Loaded parts are always served `stale: true` until a fresh snapshot
replaces them, whatever their age; `reachable`, `unreachableSince` and `lastReceivedAt` are restored. The existing
"never put an older reading over a newer one" guard (`agentSnapshotStore.ts:73-74`) already keeps a fresh agent
snapshot winning. `freshPower()` keeps ignoring old power by age (`:100-101`).

2.5 **Size bound.** The factory part is capped at **2,000,000 bytes** of serialized JSON (`LATEST_FACTORY_MAX_BYTES`,
the same figure as `MAP_WORLD_LAYER_MAX_BYTES`, `packages/shared/src/map.ts:45`; about 4,500 buildings at the measured
440 bytes each). Over it, the row is written with `factory = NULL` (never truncated: a partial factory would mislead
the bottleneck finder and the planner), and one `warn` line with the byte count is logged per crossing. After a
restart such a server's factory read waits for the next report (30 s). Status and power are small and bounded by
their schemas. Ingest's own 5 MB cap is unchanged.

2.6 **Privacy.** The status part holds `connectedPlayers` and `playerLimit` (`packages/shared/src/status.ts:19-20`),
and the page says the player count is "Shown live on the dashboard; not stored" (`privacy.html:89-90`). Persisting
status changes that, so the page needs a line. Proposed wording, owner to confirm: the counts row becomes "Shown live on
the dashboard. The latest reading is kept as a single cached copy, replaced by each new reading and deleted when the
server is removed." and "How long it's kept" gains "The latest reading of each server (status, power and factory;
never player names): one copy, replaced as new readings arrive, deleted when the server is removed." Player names
need no change (2.2).

2.7 **Removal.** Removal is a soft delete (`modules/servers/repositories/serverRepository.ts:177-181`), so the FK
cascade does not fire. `DELETE FROM telemetry.latest_snapshots WHERE server_id = $1` joins `DELETE_HISTORY`
(`:194-219`), as for every table that references `servers.servers`. The upsert is conditional on a live server
(`INSERT ... SELECT ... FROM servers.servers WHERE public_id = $1 AND deleted_at IS NULL`), so the writer's final
flush, which runs when `directory.remove` stops the runtime after the delete has committed (`server.ts:384`), cannot
bring the row back.

## Build plan

**PR 1, point 1** (contract, backend and frontend together; the frontend tolerates an older backend):
- `packages/shared/src/envelope.ts` (+ its schema test): optional `unreachableSince`.
- `backend/src/platform/snapshot.ts`, `modules/telemetry/services/agentSnapshotStore.ts`, new
  `modules/telemetry/services/lastGood.ts`, `modules/telemetry/index.ts`.
- `frontend/src/components/StatusBanners.tsx`, the four panels' bodies (`status/StatusPanel.tsx`,
  `power/PowerPanel.tsx`, `factory/FactoryPanel.tsx`, the players list in `overview/OverviewView.tsx`), `frontend/src/index.css` (token).
- Tests: `agentSnapshotStore.test.ts` (unreachable with parts returns them stale with the first unreachable time; a
  run of unreachable snapshots keeps it; reachable clears it; no parts still 503), `lastGood.test.ts` (unreachable
  serves the last success; auth rejected still throws; nothing remembered still 503), a route test that the 200 body
  validates against the shared schema, `StatusBanners.test.tsx` (banner with `unreachableSince`, and still with a 503),
  a Playwright screenshot of the dimmed Overview for ui-reviewer.

**PR 2, point 2** (after PR 1):
- `backend/migrations/<ts>_telemetry_latest_snapshots.sql` (new table, grants as in the map migration).
- New `modules/telemetry/repositories/latestSnapshotRepository.ts` (load, conditional upsert),
  `modules/telemetry/services/latestSnapshotWriter.ts` (worker), `agentSnapshotStore.ts` (export and restore its
  state), `modules/telemetry/index.ts` (wire both), `modules/servers/repositories/serverRepository.ts` (`DELETE_HISTORY`).
- `frontend/public/privacy.html` (2.6, once the owner confirms the wording).
- Tests: `latestSnapshotRepository.db.test.ts` (upsert keeps one row; no players column; a removed server's upsert
  writes nothing), `latestSnapshotWriter.test.ts` with fake timers (nothing changed, no write; at most one write in
  5 min; a write on each reachability change; flush on stop; factory over the cap written NULL with one warn),
  `agentSnapshotStore.test.ts` (restored parts are stale; a newer snapshot wins), `repositories.db.test.ts` (removal
  clears the row). The migration contract check (`scripts/migration-contract-check.mjs`) must pass unchanged.

## Consequences

- An offline game or agent and a deploy no longer blank the dashboard: the last data stays, dimmed and labelled.
- One more Postgres write path: at most 288 upserts a server a day, zero while offline, one row a server.
- The privacy page says less "not stored" than before (counts), still nothing about player names.
- A 503 `upstream_unreachable` now means "nothing to show", not "the game is down"; the banner reads both.

## Deferred

- **"Agent offline" as its own state** (agent silent, not just stale): not yet. Trigger: the owner wants a distinct
  banner for a dead agent. Cheapest step now: `lastReceivedAt` is already kept and persisted.
- **Persisting player names:** no. Trigger: a feature that needs them across restarts, with a privacy-page change.
- **Restoring the power ring buffer:** no; the ADR-0027 history covers the chart after a restart.
- **Persisting request-through last-good:** no. Trigger: a request-through server in production.
- **A shared cache (Redis):** no. Trigger: more than one backend instance (ADR-0010).

## Revisit when

- A real factory's part passes the 2 MB cap (the warn line says so).
- The upsert rate shows up in RDS write metrics, or a crash losing 5 minutes of data is reported as a problem.
- A second backend instance serves the same server (each would write its own copy).

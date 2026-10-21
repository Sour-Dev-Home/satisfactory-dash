# Runbook: production history (ADR-0027 PR 3)

With a database, the backend records each game server's power, item totals and machine-state
changes, so the dashboard can show history and the alert engine can look back. Without a
database nothing changes: the 5-minute power chart stays in memory.

## Deploy order

**The backend will not start against a database that has not been migrated** (the schema version
check, ADR-0025). So for the release that brings history:

1. Stop the backend.
2. `npm run db:migrate -w backend` (adds the `telemetry` schema: `1790553600000_telemetry_history`;
   additive, no existing table changes).
3. Start the backend.

Nothing else needs configuring. History starts filling as soon as the database is up.

## What is stored, and for how long

| Data | Cadence | Kept |
| --- | --- | --- |
| Power per circuit (`power_samples`) | every 5 s | 48 hours |
| Item totals across the factory (`item_samples`) | every 30 s | 48 hours |
| 1-minute rollups (`power_rollups`, `item_rollups`, resolution 60) | every minute | 30 days |
| 1-hour rollups (resolution 3600) | every minute (recomputed while the hour is open) | 1 year |
| Machine-state changes (`building_transitions`) | on change | 30 days |

No personal data: it describes the game world. The privacy page says so (`frontend/public/privacy.html`).

Per-sample caps (#515, ADR-0045 M11), set from the measured tier-6 save (1 circuit, 49 items, all in the item catalog),
so a forged snapshot cannot fill the database. Only history is capped: the live views and the alert board see everything.

| Cap | Value | Where |
|---|---|---|
| Circuits per power sample | 64, the lowest ids | `MAX_POWER_SAMPLE_CIRCUITS`, `telemetry/services/historyQuota.ts` |
| Items per item sample that are NOT in the item catalog (`itemForms.generated.json`) | 64, the first by class name; catalog items are always kept | `MAX_UNCATALOGED_ITEMS_PER_SAMPLE`, same file |

Rows over a cap are dropped and counted (`satis.history.rows_dropped{server,table}`), with one log line per server per
hour: `HISTORY_QUOTA_EXCEEDED` (counts only, never a class name).

## Reading it: the history API (ADR-0027 PR 4)

Server-scoped, members only, `GET /api/servers/:serverId/history/{power,items,transitions}`; `503 service_unavailable`
without a database. `range` is `1h|6h|24h|7d|30d|1y` (transitions: no `1y`; default `24h`); items take an optional
`item` (a class name), transitions a `limit` (default 100, at most 500, `truncated` says there is more).

**The range picks the resolution**: the smallest of 1 minute, 5 minutes, 15 minutes, 1 hour, 6 hours and 1 day that
keeps a series at 600 points or fewer: `1h`/`6h` 1 minute, `24h` 5 minutes, `7d` 1 hour, `30d` 6 hours, `1y` 1 day
(UTC-aligned buckets). A bucket under 1 hour is read from the 1-minute rollups, 1 hour or more from the hourly
rollups (re-bucketing 30 days of minute rows per request would touch millions of rows). Consequences:

- **The newest bucket can lag**: up to an hour on `7d`/`30d`/`1y` (the hourly rollup is recomputed while the hour is
  open), about a minute on the shorter ranges.
- **Power series never merge across game sessions** (a circuit id from another session is not the same circuit): one
  series per `(session, circuit)`, the newest data first.
- **"All items" returns at most 50**, the highest average rate first, with `truncated`.
- Every read runs in a transaction with `statement_timeout` 5 s (`SET LOCAL`); a query that runs longer, or any
  database failure, is a `503`, never a hang. Averages are weighted by samples; nothing is interpolated.
- No caching yet: the trigger is measured latency (ADR-0032).

## How it works

- Each server has a buffered recorder (flushed every 15 s, at most 20,000 rows per kind; when a
  database outage fills the buffer the oldest rows are dropped). It never slows or fails a poll.
- `FactoryHistoryPoller` (30 s per server) sums `production` across buildings and records
  state transitions. A first snapshot, or one where more than half the buildings are new, only
  sets the baseline (no transitions). A building whose state cannot be decided keeps its last state.
- `HistoryMaintenanceWorker` (one per process, started after the database is up) rolls up every
  minute, re-covering the last 5 minutes so late rows are counted, and at start catches up over the
  whole 48 h raw window. It purges every ~10 minutes in batches. Both jobs are idempotent.
- Servers are addressed by public id. A write for a server that is not registered inserts nothing.

## Gaps in history

**A gap in the stored history means the game was paused or the server was unreachable.** FRM returns
frozen values while the game is paused (`frm-api.md`), and the owner's server auto-pauses when nobody is
connected, so nothing is recorded then: no power rows, no item totals, no transitions. If the pause
state cannot be read, nothing is recorded either (never a guess). On resume, machine states are
compared with the last state seen before the pause, so frozen values make no fake transitions. Charts
show honest gaps; shading pause periods would need a separate table of pause events (not built).

## When something looks wrong

- Log line `history write failed; buffering and retrying`: the database refused a write. Logged once
  per outage; `history writes recovered` follows when it clears.
- Log line `history maintenance failed; retrying next run`: the rollup or purge failed; the next run
  retries. Rollups are rebuilt from raw rows, so a gap heals itself within 48 hours.
- A short start-up gap is normal: recorders begin before the database is ready, so their first
  flushes can fail and are retried.
- Log line `HISTORY_QUOTA_EXCEEDED`: a server's sample was over a per-sample cap (above). A real
  factory never hits it; a server that keeps hitting it is sending made-up circuits or items.
- Alarm `rds-free-storage-low` ([`aws.md`](./aws.md)): find which servers hold the rows. Run as the
  migrator or backup role in a `psql` session ([`database.md`](./database.md)); the first query reads
  sizes and the planner's estimates per table, the second exact counts for the raw tables:

  ```sql
  -- Which tables are big.
  SELECT relname, pg_size_pretty(pg_total_relation_size(oid)) AS size, reltuples::bigint AS rows_estimate
  FROM pg_class WHERE relnamespace = 'telemetry'::regnamespace AND relkind = 'r'
  ORDER BY pg_total_relation_size(oid) DESC;

  -- Which servers own the rows, largest first (raw tables; the rollups follow them).
  SELECT public_id, power_rows, item_rows, transition_rows, power_rows + item_rows + transition_rows AS total_rows
  FROM (
    SELECT s.public_id,
           (SELECT count(*) FROM telemetry.power_samples p WHERE p.server_id = s.id) AS power_rows,
           (SELECT count(*) FROM telemetry.item_samples i WHERE i.server_id = s.id) AS item_rows,
           (SELECT count(*) FROM telemetry.building_transitions b WHERE b.server_id = s.id) AS transition_rows
    FROM servers.servers s
  ) per_server
  ORDER BY total_rows DESC
  LIMIT 20;
  ```

  A server far ahead of the rest is the one to look at (its agent, or `HISTORY_QUOTA_EXCEEDED` in
  the log). Removing a server deletes its history with it (ADR-0045 O3).

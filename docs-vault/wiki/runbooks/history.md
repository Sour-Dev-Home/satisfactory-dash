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

# ADR-0022: Live power history: first background poller + in-memory ring buffer

Status: accepted (project owner), 2026-09-24

## Context
The owner wants a stock-chart-style power graph on the Power view, covering the last 5 minutes (owner decision)
(issue #74). FRM has no power history: getPower returns current values only
(docs-vault/raw-sources/frm-getPower.md field list; no history endpoint in frm-read-api.md).
So the backend must sample. This fires two deferred triggers:
- ADR-0010's poller trigger ("when alerting or history is built")
- ADR-0009's history trigger
getPower is cheap (<1 ms locally, ADR-0010). The in-game power graph's time range is
[NEEDS VERIFICATION: the owner can check in game]; the window below is configurable.

## Decision
- **Poller:** the backend's first background worker, in modules/telemetry (ADR-0014 layout). One
  per registry entry, started and stopped by the composition root. It samples getPower every 5 s,
  whether or not anyone is viewing (cheap on the owner's single server; see Revisit). Poll failures are
  logged and leave a gap; they never crash the process.
- **Storage:** an in-memory ring buffer per server, behind a source-agnostic interface
  (`PowerHistoryStore.append(sample)` / `.window(seconds)`). Window 5 min (owner decision) at 5 s = 60
  points per circuit. NO database yet: a 5-minute live window doesn't need persistence, and a
  restart simply rebuilds it within 5 minutes. The same interface will later be fed by agent
  ingest (ADR-0020) instead of the poller.
- **Samples:** { t (unix ms), per circuit: productionMW, consumptionMW, capacityMW,
  batteryPercent, fuseTriggered } plus gamePaused at sample time, so the chart can shade paused
  stretches (values freeze while paused, ADR-0012).
- **Reset rule:** if the game session changes (session name) or totalGameDurationSeconds goes
  backwards (a reload), clear the buffer. circuitGroupId stability across restarts is
  [NEEDS VERIFICATION] (ADR-0006), so series never span a reload.
- **Contract (additive, shared first):** GET /api/servers/:serverId/power/history -> ADR-0004
  envelope with data:
  `{ windowSeconds, intervalSeconds, series: [{ circuitGroupId, points: [{ t, productionMW,
  consumptionMW, capacityMW, batteryPercent, fuseTriggered }] }], pausedRanges: [{ fromT, toT }] }`.
  `t` is unix milliseconds (compact and chart-native); observedAt stays ISO. stale = true when
  the poller's last success is older than 3 intervals.
- **Delivery:** the frontend loads history once per view mount (and on refocus/reconnect), then
  appends each regular power poll (10 s, ADR-0005) client-side, trimming to the window. No extra
  polling load. When SSE arrives (ADR-0020), the push feeds the same append path.
- **Chart library:** the frontend's choice, with constraints: must be CSP-safe (no runtime
  <style> injection, no eval; ADR-0016 item 8, verified by the Playwright CSP guard) and
  accessible (a data table or summary alternative). Candidates: a lightweight SVG/canvas chart
  such as uPlot or a Recharts-style library [NEEDS VERIFICATION per library in the guard].

## Consequences
- Continuous 5 s sampling against the local game server, with trivial cost.
- History is lost on backend restart (up to 5 minutes). That's acceptable for a live window.
- The poller establishes the pattern (lifecycle, failure handling, staleness) that ADR-0020's
  ingest and future alerts reuse.

## Revisit when
- History beyond the in-memory window is wanted (hours or days, charts across restarts, alert
  "since when") -> Postgres snapshot_history with rollups (ADR-0009/0020).
- More than one backend instance, or many servers -> the viewer-driven cadence (ADR-0020) replaces
  always-on 5 s sampling.

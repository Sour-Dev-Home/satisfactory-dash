# Data gap analysis

Tracks which player-facing metrics are covered by an existing API vs. which require a
custom mod. Fill this in during the Phase 2 spike (see project README), after hitting
both the vanilla Dedicated Server HTTPS API and the FicsitRemoteMonitoring API with
real requests against a test server.

| Metric | Source | Status |
|---|---|---|
| Production rate per building | FRM `/getFactory` | to confirm |
| Overflow (belt backed up) | ? | to confirm |
| Power outage / deficit | FRM (power draw, battery excess/deficit) | to confirm |
| Player position/inventory | FRM `/getPlayer` | to confirm |
| Server health / uptime | Vanilla HTTPS API | to confirm |

Only add a row to the "needs custom mod" list once both existing APIs have been
checked and found not to provide it.

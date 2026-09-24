# ADR-0028: External uptime monitoring and a public status page

Status: accepted (project owner), 2026-09-24: Better Stack, a public status page, the ops@ alias
(created). Roadmap 2a: in place **at ADR-0025 gate A**, when the database goes live. The Web and
API-live monitors can start now. API ready starts after the PC runs a backend build that includes
`/api/health/ready` (#103); before that it would answer 404 and alert.

## Context
- The API runs on the owner's PC behind the Cloudflare Tunnel (ADR-0013). When the PC, the
  tunnel, the backend or (after gate A) Postgres is down, nothing inside the system can report
  it. ADR-0027's alerts only run while the PC is up.
- ADR-0025 decision 6 split health: `/api/health` is liveness (the process is up) and
  `/api/health/ready` also runs `SELECT 1`. Both are public and reveal nothing (a bare `status`),
  and the readiness schema is in the contract (PR 4, #109).
- The PC is off at times by design (the owner's gaming PC), so "down" is expected and needs
  honest framing, not an SLA.

## Decision
1. **An external free-tier monitor, configured by the owner** (no session creates accounts).
   Recommended: Better Stack (10 monitors, 3-minute checks, one status page on the free tier).
   Alternative: UptimeRobot (50 monitors, 5-minute checks; its free-plan commercial-use terms
   changed twice recently). The choice is owner decision 1.
2. **Monitors** (all public GETs, no secrets):
   | Monitor | URL | Pass | Tells us |
   |---|---|---|---|
   | API ready | `https://api.satis-manager.com/api/health/ready` | 200 and body contains `"ok"` | the whole chain works: PC, tunnel, backend, DB |
   | API live | `https://api.satis-manager.com/api/health` | 200 | if only "ready" fails, the DB (or a readiness dependency) is down, not the PC |
   | Web | `https://satis-manager.com/` | 200 | Cloudflare frontend |
   | Demo | `https://demo.satis-manager.com/` | 200 | demo (once ADR-0026 deploys) |
   Alert after **2 consecutive failures** (the provider's confirmation setting) to avoid flapping
   on a single tunnel hiccup. Game servers aren't monitored externally: they're never exposed
   (ADR-0013), and ADR-0027 covers "game server unreachable".
3. **Where alerts go:** email to a new ops alias, `ops@satis-manager.com` (Cloudflare Email
   Routing to the owner). Keep `privacy@` for users. Later, the same ops Discord channel ADR-0027
   uses for its "server unreachable" alerts.
4. **A public status page** at `status.satis-manager.com` (a CNAME to the provider)
   (Better Stack's custom-subdomain docs: a CNAME to `statuspage.betteruptime.com`, **DNS-only
   in Cloudflare, not proxied**). It shows API, Web and Demo, framed
   honestly: "The live API runs on the owner's PC and is offline when it's off; the demo is
   always available." It links the demo. Planned restarts use the provider's maintenance windows.
5. **Guardrails:**
   - The readiness body stays detail-free (it's public).
   - A 3-minute `SELECT 1` costs nothing.
   - If Cloudflare's WAF or bot rules block the monitor, allow the provider's published IP
     ranges only for the two `/api/health*` paths, never globally. Check this at setup.

## Consequences
- The first answer to "is it up?" that doesn't depend on the PC being up.
- The status page publicly shows the expected downtime: the honest framing matters more than
  the percentage.
- One more external account for the owner (free).

## Revisit when
- More than one API instance or a load balancer: the orchestrator's health checks use `/ready`.
- The API moves to AWS (ADR-0014): replace or complement with Route 53 health checks and
  CloudWatch alarms.
- Error tracking (before sharing, roadmap 8) arrives: link its alerts to the same ops channel.

## Owner steps (after owner decision 1)
1. Create the ops alias `ops@satis-manager.com` in Cloudflare Email Routing.
2. Sign up at the chosen provider, then create the 4 monitors from the table (the Demo monitor
   once the demo is live), with confirmation = 2 and alerts to ops@.
3. Create the status page. Add a CNAME `status` in Cloudflare DNS to the provider's target (DNS
   only, not proxied, unless the provider says otherwise).
4. Trigger a test: stop the backend for 10 minutes and confirm one alert and one recovery.

## Decisions for the owner
1. Provider: **A Better Stack (recommended)** / B UptimeRobot.
2. Publish the status page at status.satis-manager.com with the honest framing? **Recommend yes.**
3. A separate `ops@` alias for monitoring email? **Recommend yes.**

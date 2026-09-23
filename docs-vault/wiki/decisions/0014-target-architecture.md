# ADR-0014: Target architecture: modular monolith now, service-based + edge agent later

Status: accepted (project owner), 2026-09-23

## Context
Today's system is a layered monolith: one backend deployable, technically partitioned into
adapters/ -> services/ -> routes/ (backend/CLAUDE.md), plus a separately deployed SPA and a shared
contract. It has no database, calls the game server on each request (ADR-0010), and assumes the
backend runs next to the only game server (ADR-0013). It fits one operator and one server.

The stated end goal changes the drivers:
1. **Accounts:** many users, each managing several servers (multi-tenant).
2. **Live map:** buildings drawn at their real world positions, with switchable layers for
   production, power and more. FRM already exposes location x/y/z/rotation per building
   (frm-getFactory.md:23-27; verified in capture 01-running).
3. **Managed servers:** the project provisions dedicated servers on AWS with SML + FRM
   preinstalled, as an alternative to self-hosting.
4. **Self-hosted servers:** these sit behind home NAT, and FRM is plain HTTP only (ADR-0013,
   PR 3's FRM-host guard). A cloud backend can't and must not call them directly.

Per Fundamentals of Software Architecture (Richards & Ford) ch. 18: when parts of a system need
different architecture characteristics, that implies a distributed architecture. Here they do:
- ingest: throughput and elasticity as servers × poll rate grows
- web/API: availability, security, responsiveness
- provisioning: reliability, auditability, cloud permissions; low volume, long-running work

## Decision
Target style: **service-based architecture** (book ch. 13), with an event-driven push path and
an edge agent. It's reached in steps, starting with a **modular monolith** (book ch. 18).
- **Edge agent (collector):** a small separately deployed process beside each game server. It
  polls FRM and the vanilla API over loopback (today's adapters/ layer, relocated) and pushes
  validated snapshots OUTBOUND over HTTPS to the cloud, with a per-server credential. The same
  agent runs on self-hosted PCs and inside managed AWS servers, so there's one ingestion path
  for both. This is the key decision: it removes inbound access to user networks and FRM exposure.
- **Coarse domain services** (a few, not many), sharing one Postgres with per-service schema ownership:
  1. Identity & tenancy: users, sessions, server ownership
  2. Server registry & telemetry ingest: agent auth, snapshot storage, history
  3. Web API + push gateway: reads snapshots, fans updates out to browsers over SSE
     (ADR-0005's reserved envelope)
  4. Provisioning, only if managed hosting ships: an AWS workflow orchestrator for
     create/start/stop/backup/delete
- **Frontend:** a map core with layer plug-ins (book ch. 12, microkernel: plug-ins "enhance or
  extend the core system"). Each layer (factory icons, power circuits, later belts and trains)
  implements one layer contract over the shared snapshot types.
- **Not chosen:**
  - microservices: one developer, and the cost and coordination aren't earned (book ch. 17/18)
  - space-based: no extreme concurrent write load
  - orchestration-driven SOA: legacy enterprise style
  - pure event-driven everywhere: the book recommends the request-based model for "well-structured,
    data-driven requests" (ch. 14); only the snapshot fan-out needs events.

## Consequences
- Each step is independently useful. Domain boundaries drawn inside the monolith now become
  service boundaries later without a rewrite.
- One shared database keeps ACID transactions per domain (book ch. 13: service-based "preserves
  ACID transactions better than any other distributed architecture"). The price is schema
  coupling, managed by per-service schema ownership.
- The agent becomes a versioned product with its own release and update story, and its
  push protocol becomes a second public contract (it belongs in packages/shared).
- The architecture stays resume-legible: Postgres/RDS, ECS, SSE, a TypeScript agent.

## Steps and triggers
| Step | When |
|---|---|
| Domain-partition the backend (identity, servers/telemetry, settings) inside the one deployable; modules talk only through interfaces | now, cheap |
| Contract: building location (world meters + rotation) | when map work starts |
| Poller + snapshot store + SSE | live map, alerts/history, or >1 viewer (ADR-0005/0010 triggers) |
| Postgres (ADR-0009) | first multi-user account |
| Edge agent + ingest endpoint | first server the backend can't reach on loopback (a second user, or the backend moves to AWS) |
| Split into separate deployables | measured need: ingest load hurting the web API, or different deploy cadences |
| Provisioning service | managed hosting approved by the owner (cost, pricing, terms) |

## Owner decisions (2026-09-23)
- **Two hosting modes:**
  - self-hosted (free): the user runs the edge agent next to their own server
  - managed (paid): a fixed price above AWS cost, with a guarantee and easier setup
- **Managed-hosting compute is NOT serverless.** A game server is a long-running, stateful
  process that needs 8 GB RAM (16 GB for large saves or 4+ players, per
  satisfactory.wiki.gg/wiki/Dedicated_servers) and game ports open. Use one EC2 instance (or ECS
  task) per game server, stopped when idle to control cost. Only the stateless parts can
  lean serverless (the web API, ingest).
- **Legal gate before any paid launch** (not legal advice; the owner confirms with Coffee Stain
  and, ideally, a lawyer):
  - Satisfactory's own EULA and Coffee Stain's "Content Usage Guidelines" are unverified here
    (the EULA page didn't load). Coffee Stain's published EULA pattern (Valheim §5.2.1) bans
    commercial use "except as expressly permitted".
  - Precedent: several commercial hosts (Nitrado, G-Portal, Shockbyte) openly sell Satisfactory
    servers, and the official wiki lists no licensing restrictions on dedicated servers.
  - FRM's repository has no license (all rights reserved by default), so preinstalling it on
    paid servers needs its author's permission. SML is GPL-3.0.
  - The map image is Coffee Stain content. Owner decision: proceed, relying on the precedent of
    public community tools such as satisfactory-calculator. The base map is a pluggable layer:
    its image source and world bounds are configuration, and it's always served from assets
    we host, never hotlinked or scraped from another site. Swapping to a self-drawn map is a
    config change.
  - Don't use Coffee Stain logos or imply endorsement. Show "not affiliated with Coffee Stain
    Studios" on the site.

## Revisit when
- Ingest volume outgrows one Postgres primary after partitioning and vertical scaling (then
  consider a time-series store).
- A second developer or team owns a domain.

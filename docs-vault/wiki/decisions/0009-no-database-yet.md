# ADR-0009: No database yet; Postgres with visible SQL at the trigger

Status: accepted, 2026-09-22

## Context

All data is live game state; nothing needs to persist today.

## Decision

No database now. The trigger is the first feature needing history, alert state ("outage
started at"), user accounts (ADR-0011 revisit), or a persisted server registry (ADR-0001 revisit).
Then: Postgres (RDS on AWS), a real migration tool, repositories in backend/src/persistence/, and
a schema in our own domain terms, never FRM shapes. Library constraints fixed now: it must bundle
with esbuild into the single dist/server.cjs (no native query-engine binaries), and SQL stays
visible. Candidates: pg + node-pg-migrate, or Drizzle. Time-series growth: timestamp indexes and
retention/rollups first; partitioning only when measured. Read replicas and sharding: not
applicable at this scale.

## Consequences

No database to run or pay for until a feature earns it; the eventual choice is
already constrained.

## Revisit when

The trigger fires.

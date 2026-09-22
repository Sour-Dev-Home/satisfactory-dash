# ADR-0010: Request-through; no cache or poller yet

Status: accepted, 2026-09-22

## Context

Measured locally on a 338-building save: getFactory ~25 ms / 463 KB raw, getPower <1 ms,
QueryServerState ~87 ms. One viewer.

## Decision

Each request calls the game server. No cache, no poller.
Triggers: (a) poller (backend/src/pollers/) when alerting or history is built (ground rule 3);
it must record paused intervals rather than treat frozen values as real (ADR-0012). (b) An
in-process TTL cache (a decorator implementing the *AdapterLike interfaces) if more than one viewer
multiplies FRM calls before a poller exists. (c) Redis only with more than one API instance.
Keep /api/factory lean (no inventories/locations) and add compression when deployed.

## Consequences

Always-live data, no invalidation logic. Game-server load scales with viewers.

## Revisit when

Any trigger above fires, or the mapped /api/factory size (measured after PR 2b)
calls for a summary mode.

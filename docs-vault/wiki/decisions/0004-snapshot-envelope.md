# ADR-0004: Snapshot envelope on every data response

Status: accepted, 2026-09-22

## Context

Every request calls the game server live today. A background poller is planned (ground
rule 3). If freshness isn't in the contract now, the frontend changes when snapshots arrive.

## Decision

Every data response is { serverId, observedAt (ISO-8601 UTC), stale, data }. The backend
decides `stale`, which avoids client clock skew. Today observedAt = fetch time and stale = false.
With a poller: refresh failing but a snapshot exists -> 200 with stale: true; no snapshot ever ->
error envelope. The frontend builds its stale UI now against a stale fixture. "Game paused"
(status.gamePaused, ADR-0012) is a separate state from stale and gets its own UI.

## Consequences

Switching from request-through to snapshots needs no contract change.

## Revisit when

A consumer needs per-field freshness (unlikely; add fields then).

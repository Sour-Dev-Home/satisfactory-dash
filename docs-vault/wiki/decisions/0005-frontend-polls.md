# ADR-0005: The frontend polls; push is deferred

Status: accepted, 2026-09-22

## Context

One server, few viewers, no poller yet. WebSockets would add connection state, auth on
upgrade, and reconnect logic with nothing to push that polling can't deliver.

## Decision

The frontend polls status/power every ~10 s and factory every ~30 s. No push/event types
in shared yet. Any future push message is { type: "<resource>.updated", serverId, payload }, where
payload IS the ADR-0004 envelope, so push reuses every schema.

## Consequences

Simple, cacheable, stateless. Worst-case staleness equals the poll interval.

## Revisit when

A poller exists AND alerts must arrive faster than the poll interval, or viewer
load is measurable. Then use SSE first (the flow is one-way); WebSocket only for client -> server
messages.

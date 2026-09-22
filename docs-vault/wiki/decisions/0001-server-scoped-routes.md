# ADR-0001: Server-scoped routes from day one

Status: accepted, 2026-09-22

## Context

One game server today; several are planned, with no timeline. Root CLAUDE.md promises
"one server now, many via AWS later" is a config change, not a rewrite. Today's routes are
unscoped (/api/status, /api/factory, /api/power; backend/src/routes/*.ts), so adding a second
server would change every URL the frontend knows.

## Decision

Data routes are /api/servers/:serverId/{status,factory,power}. GET /api/servers returns
{ servers: [{ id, displayName }] }, never host or port. /api/health stays unscoped. Single-server
mode is a registry of one: SATISFACTORY_SERVER_ID (default "default") and
SATISFACTORY_SERVER_NAME. serverId must match ^[a-z0-9-]{1,32}$ (else 400 bad_request); an
unknown id returns 404 server_not_found. The registry loader lives in adapters/config.ts, a
ServerDirectory (list(), get(id) -> per-server services) in services/serverDirectory.ts, and
server.ts builds the one-entry map. The frontend discovers servers via /api/servers and
auto-selects when there is exactly one.

## Consequences

The frontend is built against multi-server URLs once. A second server is a registry
entry. The cost now is one indirection (ServerDirectory) and a serverId in every data URL.

## Revisit when

A second server exists. Then choose registry storage (env list vs database, see
ADR-0009) and per-server credentials handling.

# ADR-0012: Auto-pause off by default, with a user toggle; paused state is visible

Status: accepted (the project owner), 2026-09-22

## Context

FG.DSAutoPause=True pauses the sim with 0 players, and FRM then returns frozen values
(observed 2026-09-22). Users want different behavior. A paused server is billed the same (the
process keeps running), and live values, alerts and history can't work while it's paused.
GetServerOptions, the only documented way to read the setting (dedicated-server-api.md:392-401),
also returns FRM's uWS.AuthenticationToken in plaintext.

## Decision

The dashboard changes the setting only on an explicit user action; docs recommend off.
GET /api/servers/:serverId/settings -> ADR-0004 envelope with
{ autoPause, pending, editable }. PUT /api/servers/:serverId/settings/auto-pause { enabled }
calls ApplyServerOptions (dedicated-server-api.md:541-551, Admin), re-reads, and returns the
settings envelope. editable = apiToken configured AND VerifyAuthenticationToken succeeds
(:313-316) AND the token payload pl == "Administrator" (:248-268). Not editable -> 409
not_editable. The backend never proxies, logs, stores or returns GetServerOptions output. One
adapter function reads it and keeps only FG.DSAutoPause from ServerOptions and
PendingServerOptions; a test with a fake token asserts the token appears in no output or log.
One audit log line per change (requestId, serverId, user, old -> new).
status.isPaused is renamed gamePaused in PR 2b; the UI shows a "Paused: no players connected,
values are frozen" banner separate from stale. The toggle's help text says pausing doesn't lower
hosting cost and freezes live values, alerts and history.

## Consequences

The dashboard's first write to the game server, gated by ADR-0011, reviewed by
security-reviewer before merge.

## Revisit when

More settings need toggles. Generalize to an allowlisted settings map, never a
passthrough.

Verified live 2026-09-23 (local server, AllowInsecureLocalAccess): DSAutoPause applies
immediately (ApplyServerOptions returned 204, the next GetServerOptions showed the new
value, PendingServerOptions stayed empty). Response keys are camelCase (`serverOptions`,
`pendingServerOptions`), not the docs' PascalCase; the request key `UpdatedServerOptions`
is PascalCase as documented. The `pending` field still reflects PendingServerOptions in
case a server does queue the change.

Amended 2026-09-23 (architect): `editable` accepts `pl` in {"Administrator", "APIToken"}
(never "InitialAdmin", "Client" or "NotAuthenticated"), not `Administrator` alone. The
dashboard is a third-party application, and the docs tell those to use application tokens
(`server.GenerateAPIToken`; do not expire; `server.InvalidateAPITokens` revokes them;
dedicated-server-api.md:279-284), whose privilege level is `APIToken` (:248-268).

Still [NEEDS VERIFICATION], with a real application token on a server that enforces
authentication: that GetServerOptions is readable with it, and that ApplyServerOptions
accepts it. If the write is refused, `APIToken` leaves the editable set and that becomes the
recorded fact. The privilege GetServerOptions requires is also unverified (the local server
needed no token).

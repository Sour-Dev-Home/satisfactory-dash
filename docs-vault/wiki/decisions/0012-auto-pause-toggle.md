# ADR-0012: Auto-pause off by default, with a user toggle; paused state is visible

Status: accepted (Leonardo), 2026-09-22

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
passthrough. [NEEDS VERIFICATION]: DSAutoPause applying immediately rather than going to Pending;
the privilege GetServerOptions requires.

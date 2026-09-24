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

Verified live 2026-09-23 with a real application token (`pl` = `APIToken`, from
`server.GenerateAPIToken`) on the local server: GetServerOptions is readable with it, and
ApplyServerOptions accepts it (204; the value changed and was restored). A wrong token is
answered 401 `invalid_token` even with AllowInsecureLocalAccess, so the header is checked.

Amended 2026-09-23 (found by that live check): **VerifyAuthenticationToken does not work as
documented** (dedicated-server-api.md:313-316 says no parameters and 204). On the live
server it answers HTTP 200 with `errorCode: missing_params` (missing `authenticationToken`
and `privilegeLevel`), and with those supplied it answers 401 `token_validation_failed` for
every privilege level, even for the working token. So `editable` no longer uses it: the
"server accepts the token" test is that an authenticated GetServerOptions call is not
answered 401/403. `editable` = apiToken configured AND `pl` in {"Administrator",
"APIToken"} AND the server accepts the token. A write the server still refuses with
401/403 is a 409 `not_editable`, not a 502. GetServerOptions was also readable without any
token on this server (AllowInsecureLocalAccess), so on such a server the accept check is
trivially true and does not prove the token's privilege; on an auth-enforcing server the
write itself is the proof, and its refusal maps to 409.

A lost write response (2026-09-24, architect ruling): the request deadline is now overall, so a
slow-but-steady `ApplyServerOptions` response can be cut after the server applied the value.
Setting `FG.DSAutoPause` is idempotent, so on a transport failure (`failureKind: "unreachable"`)
of the write the settings service reads the option back ONCE through the same allowlisted
`GetServerOptions` call. If the applied value is the requested one the wanted end state holds: the
route answers 200 with the settings envelope. The audit line must not claim a change it cannot
know about, so it records `requested`, `observed` (both the requested value) and `previous` (the
value read just before the write) with `outcome: "confirmed by re-read"`, never a from -> to.
When the option already held the requested value, or someone else set it to that value at the same
time, that is indistinguishable from the write having landed, and harmless: the user asked for an
end state and it holds. Otherwise, or if the read-back fails too, the original 503
`upstream_unreachable` stands (with no audit line, since nothing is known to have changed). The
write itself is never retried, and plain HTTP errors (500, an invalid body) are not read back.

Live check on an auth-enforcing server (2026-09-24, go-live runbook section 3): with
AllowInsecureLocalAccess removed, the game API answered 403 without a token and 200 with the
application token (`pl` = APIToken). Through the built backend, `editable` was true, and the
auto-pause flip (false to true) and restore both returned 200; the game server's
`FG.DSAutoPause` read back as its original value. The refused-token path (a token the server
refuses giving 401/403, mapped to 409 `not_editable`) was not exercised and stays untested.

Still [NEEDS VERIFICATION]: the privilege GetServerOptions and ApplyServerOptions require on
an auth-enforcing server (that a non-admin token is refused), and what
VerifyAuthenticationToken's `privilegeLevel` parameter expects.

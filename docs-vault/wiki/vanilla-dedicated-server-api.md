# Vanilla Dedicated Server API

Summary of the official Satisfactory Dedicated Server API, derived from
`docs-vault/raw-sources/dedicated-server-api.md` (captured 2026-09-21 from the local
Steam install's `CommunityResources/DedicatedServerAPIDocs.md`).

## Two endpoints, one port

Both live on the server's game port (default `7777`, configurable via `Engine.ini` or
`-Port=`).

1. **Lightweight Query API** — a UDP protocol for cheap, continuous polling of coarse
   server state (online/loading/playing, tick rate presence, sub-state version
   counters). Designed to be pinged repeatedly without load; unreliable by nature
   (UDP), so callers should poll on an interval rather than wait for a single response.
2. **HTTPS API** — the detailed, authenticated JSON-RPC-style API. Single POST
   endpoint per server; every call sends `{"function": "<Name>", "data": {...}}` and
   gets back either an Error Response (`errorCode`, `errorMessage?`, `errorData?`) or a
   Success Response (`data`).

The Lightweight Query API stays available while the HTTPS API is temporarily down
(e.g. during a map load) — useful for a "server is up but loading" distinction in an
outage detector.

## Auth

- Bearer tokens, obtained via `PasswordlessLogin` / `PasswordLogin`, or long-lived via
  `server.GenerateAPIToken` console command (recommended for a third-party dashboard —
  doesn't expire, isn't tied to a player account, no password flow needed).
- Privilege levels: `NotAuthenticated`, `Client`, `Administrator`, `InitialAdmin`,
  `APIToken`.
- For a local dev/test server, `FG.DedicatedServer.AllowInsecureLocalAccess=1` disables
  auth entirely for loopback connections — convenient for the Phase 2 spike, not for
  anything pointed at a real server.
- The server's TLS cert is self-signed by default; any HTTP client this project writes
  needs to either accept that explicitly (e.g. `-SkipCertificateCheck` in the
  PowerShell example) or have the user supply a real cert chain.

## Functions relevant to this project (read-only / monitoring)

| Function | Returns | Notes |
|---|---|---|
| `HealthCheck` | `Health` ("healthy"/"slow"), `ServerCustomData` | No auth required. Good liveness probe. |
| `QueryServerState` | `ActiveSessionName`, `NumConnectedPlayers`, `PlayerLimit`, `TechTier`, `GamePhase`, `IsGameRunning`, `TotalGameDuration`, `IsGamePaused`, `AverageTickRate`, `AutoLoadSessionName` | Server/session-level only — no per-building or per-factory data. |
| `GetServerOptions` / `GetAdvancedGameSettings` | Server config maps | Config, not live production data. |
| `EnumerateSessions` | List of save files + headers | Admin only. |

**Observation (directly from the function list, not inferred):** the vanilla HTTPS API
has no concept of individual buildings, belts, power circuits, or production rates —
its data model stops at session/server metadata (tick rate, player count, phase,
uptime). Anything about production rate, belt overflow, or per-circuit power draw will
need to come from FicsitRemoteMonitoring (see `frm-api.md`), not this API. This API is
still useful on its own for: server-up/down detection (`HealthCheck` +
`QueryServerState.IsGameRunning`), tick-rate/performance health, and player-count
tracking.

## Write/management functions (out of scope for now)

`ClaimServer`, `RenameServer`, `SetClientPassword`, `SetAdminPassword`,
`SetAutoLoadSessionName`, `RunCommand`, `Shutdown`, `ApplyServerOptions`,
`ApplyAdvancedGameSettings`, `CreateNewGame`, `SaveGame`, `DeleteSaveFile`,
`DeleteSaveSession`, `LoadGame`, `UploadSaveGame`, `DownloadSaveGame` all exist but are
server-management actions, not monitoring data. Not needed for the dashboard's current
scope (read-only monitoring); noting them here so a future "restart/manage server from
the dashboard" feature doesn't require re-reading the raw source from scratch.

## Confirmed against a live server (Phase 2 spike, 2026-09-21)

Ran against GameVersion 1.2.4.0 (CL 502094), a local dedicated server + SML 3.12.0 +
FRM 1.5.3. Two real discrepancies from the documented schema, both worth remembering
when writing the adapter's types — don't trust the doc's exact casing/field lists
without cross-checking a live response:

- **Response field casing is camelCase, not PascalCase.** The doc's tables list
  `ServerGameState`, `ActiveSessionName`, etc.; the live `QueryServerState` response
  actually returns `serverGameState`, `activeSessionName`, `numConnectedPlayers`, and
  so on — see `raw-sources/captured-responses/vanilla-QueryServerState-sample.json`.
  This is presumably true for every function's response, not just this one.
- **`CreateNewGame` requires an undocumented `GameModeSettings` field**, and its
  `SkipOnboarding` field is actually named `bSkipOnboarding` (Unreal's bool-prefix
  convention) rather than what the doc's `ServerNewGameData` table lists. See
  `raw-sources/captured-responses/vanilla-CreateNewGame-discrepancy.md` for the exact
  error sequence. The doc was accurate enough to get close, but not byte-exact —
  expect this for other write/admin functions too, though only `CreateNewGame` and the
  read-only functions above have actually been exercised live.

`HealthCheck` and `QueryServerState` (read-only, the two most relevant to this
project) both worked exactly as documented aside from casing.

## Full reference

For exact request/response field types and error codes, see
`docs-vault/raw-sources/dedicated-server-api.md` directly — this page is a navigation
aid, not a replacement. Treat the field casing there as approximate; confirm against a
live response before hardcoding a field name into the adapter.

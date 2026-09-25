# ADR-0030: Managing multiple servers (operator-managed local servers now, players' own servers via the edge agent)

Status: accepted (project owner), 2026-09-25. Owner request: "Players need to be able to manage
multiple servers." Owner decisions at the end: two phases; the edge agent for players (ADR-0031); LAN
allowed in phase 1; encrypted DB tokens as the single source; caps 8 / 3.

## Context
- Switching already exists. Routes are server-scoped (ADR-0001), `GET /api/servers` is per-user
  (ADR-0025 PR 6), and the frontend's ServerGate shows a picker when there's more than one server,
  with a ServerSwitcher in the shell (frontend/src/servers/). The app "starts with an assumed server"
  only because exactly one server is configured.
- Servers come from config today: `SATISFACTORY_SERVERS_FILE` (N servers, ADR-0025 PR 1) or the
  single-server env. They're registered in the DB at startup with the operator as owner. Each has its own
  pollers, started once at boot.
- The backend runs on the owner's home PC behind the tunnel (ADR-0013). A server's tokens are
  powerful: the app uses an `APIToken` (privilege level "Third Party Application",
  raw-sources/dedicated-server-api.md:262-268), which can change server options (our auto-pause toggle
  relies on it). FRM speaks plain HTTP with its own token.
- ADR-0014/0017/0020 already chose the **edge agent** for servers not on the owner's PC: the agent
  holds the game credentials beside the server, connects OUT, and enrolls with a single-use code.
  The cloud never holds game credentials. This request fires that ADR-0020 trigger.

## Decision
1. **Two kinds of server, one registry.** `servers.servers` gains `connection_kind`:
   - `local`: reached directly by this backend. **Operator only.** Loopback, or a private LAN address
     if the owner allows it (decision 3).
   - `agent`: another player's server, reached only through their edge agent (phase 2).
   The UI lists, switches, renames and removes both kinds the same way.
2. **Phase 1: the operator manages local servers in the UI**, replacing the config file:
   - Add, edit (name, host, ports, rotating tokens) and remove. Only the seeded operator identity
     may do this. Owner/admin membership isn't enough, because it touches the operator's own network.
   - Validation on add (**owner decision: LAN allowed**). The resolved address must be in the
     allowlist, nothing else:
     - allowed: 127.0.0.0/8, ::1, 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16 (loopback + RFC1918);
     - IPv4-mapped IPv6 (::ffff:a.b.c.d) is judged by its embedded IPv4;
     - everything else is **refused**: public addresses, link-local 169.254.0.0/16 (including the
       169.254.169.254 metadata address) and fe80::/10, 0.0.0.0/8, 100.64.0.0/10 (CGNAT), multicast,
       broadcast, and IPv6 ULA (not RFC1918, not in the approved list).
     - A hostname is resolved, and EVERY resolved address must be allowed. The first allowed address
       is pinned and the backend connects to the pinned IP (no DNS rebinding). It's re-validated on
       every connect and on every edit.
     - Ports are 1-65535. A **test connection** (QueryServerState plus FRM getSessionInfo) must pass
       before saving.
   - **Accepted trade-off (owner, 2026-09-25):** for a LAN host, FRM traffic, including the FRM token,
     crosses the LAN in plain HTTP (FRM has no TLS), so anyone on the LAN could read it. The vanilla
     API uses HTTPS (with a self-signed certificate). The UI shows this warning when a non-loopback
     host is entered.
   - Tokens are **encrypted at rest**: AES-256-GCM, a random nonce per value, a key from
     `SERVER_SECRETS_KEY` (32 bytes, validated at startup), and a stored key id so the key can be rotated.
     Tokens are write-only in the API (only "set / last 4" is returned) and never logged. A DB backup
     therefore holds only ciphertext, and a restore needs the key from .env. **The owner backs up
     SERVER_SECRETS_KEY offline, like the age key** (in his password manager), and the restore
     rehearsal gains a check: a restored DB decrypts one stored token with the backed-up key.
   - Runtime pollers: a ServerRuntime registry starts and stops each server's pollers on add and
     remove (today they only start at boot). There's a cap of 8 local servers, and FRM cadence stays
     per ADR-0022/0027.
   - Remove = soft delete (the existing rule deletes memberships), stop the pollers, and **wipe the
     encrypted tokens**. The server's history follows ADR-0027 retention.
   - Migration: the DB becomes the single source of truth. A one-time `npm run admin -- import-servers`
     copies the servers file or the single-server env into the DB (encrypted), then those env vars are
     removed. At startup, DB servers win; if the config is also set, one warn names the ignored variables.
3. **Phase 2: players' own servers via the edge agent (its own ADR, 0031).** Building it is a
   separate owner decision after phase 1.
   - An invited user clicks "Add server", which creates the server + owner membership + a single-use
     enrollment code (ADR-0020's guarded UPDATE). They run the agent next to their server:
     `agent enroll <code>`.
   - The agent keeps the game and FRM tokens **on their machine**, authenticates to our API with a
     per-server credential (stored hashed), and pushes snapshots; writes (auto-pause) go through
     ADR-0020's command queue.
   - Our backend **never stores their game credentials and never connects to their host**. There's no
     SSRF surface, no custody of third-party admin tokens, and no need for them to expose FRM (plain
     HTTP) to the internet.
   - Limits: per-agent ingest rate and payload caps, max servers per user (3 suggested), and
     viewer-driven cadence (ADR-0020).
4. **Rejected: letting players enter a remote host and tokens for our backend to poll.** It would make
   the owner's home PC hold other people's admin-level tokens and connect to arbitrary internet hosts
   (SSRF, and his home IP becomes the source of scans). It would also require players to expose
   unencrypted FRM publicly.

## Security posture changes (owner approval needed)
- Phase 1: the operator's own tokens move from .env into the DB, encrypted; the key stays in .env.
  The same custodian (the owner), with a new store and a key to manage.
- Phase 1: the operator can make the backend connect to a host he enters (loopback, or LAN if allowed).
- Phase 2: NO third-party credential custody and NO outbound connections to player hosts. That's the
  point of the agent.
- The privacy page gains rows when other players' servers exist (their game telemetry, their players'
  names), following the standing rule, in phase 2.

## Build plan (phase 1)
| # | PR | Owner | Tier |
|---|---|---|---|
| 1 | This ADR (docs) | dev | skip |
| 2 | platform/secrets: AES-256-GCM with a key id, SERVER_SECRETS_KEY validation | dev | FULL + security |
| 3 | Schema: `connection_kind` + servers.server_connections (host, ports, encrypted tokens, key_id) + repository | dev | FULL |
| 4 | ServerRuntime (start/stop pollers per server), DB-backed directory, the import-servers CLI, startup precedence | dev | FULL |
| 5 | Contract + API: POST /api/servers, PATCH/DELETE /api/servers/:id, test-connection; operator-only checks; rate limits | dev | FULL + security |
| 6 | UI: add/edit/remove (operator only), write-only token fields, the test-connection result, the LAN plain-HTTP warning, the empty state; demo data (a simulated test connection, no network) | fe | QUICK + ui-reviewer |
| 7 | **A security-reviewer pass over the COMBINED phase-1 diff (#2-#6) before any deploy** (a new credential store + operator-directed outbound connections) | dev | review |

Notes: #5 carries the contract AND the routes together, because the generated IDOR tests pick up
PATCH/DELETE /api/servers/:serverId at once (the ADR-0029 lesson). Every PR is from main, no stacking.
The runbook section (key backup, import CLI, retiring SATISFACTORY_SERVERS_FILE) lands with #4.
Deploy order: set SERVER_SECRETS_KEY and back it up -> deploy -> run import-servers -> remove the old
env vars -> restart -> verify.

## Owner decisions (answered 2026-09-25)
1 yes (two phases). 2 A: edge agent (ADR-0031). 3 B: LAN allowed (loopback + RFC1918 only; plain-HTTP
FRM trade-off accepted). 4 yes: encrypted DB tokens as the single source, servers file retired, key
backed up offline. 5 yes: caps 8 local / 3 agent per player.

## Decisions as proposed
1. Two phases (local servers now, players' servers via the agent later)? **Recommend yes.**
2. Players' own servers: **A the edge agent (recommended)** / B the backend polls hosts and tokens they enter (rejected above).
3. Phase 1 hosts: **A loopback only (recommended, safest)** / B also private LAN addresses (FRM tokens cross the LAN in plain HTTP).
4. Tokens in the DB, encrypted, with the DB as the single source of truth (retiring the servers file)? **Recommend yes.**
5. Caps: 8 local servers for the operator; later 3 agent servers per player? **Recommend yes.**

## Revisit when
- The API moves to AWS: the "local" kind disappears (nothing is local to the cloud); the owner's own
  servers use the agent too.

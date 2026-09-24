# ADR-0017: Credential lifecycle for game servers (self-hosted, managed, and today's single server)

Status: accepted (project owner), 2026-09-24

## Context
Three kinds of secret protect a game server:
- the FRM auth token (`uWS.AuthenticationToken`, plain-HTTP API)
- the vanilla application token (`server.GenerateAPIToken`; doesn't expire; `server.InvalidateAPITokens`
  revokes ALL of them; dedicated-server-api.md:279-284)
- the server admin password
Today one operator pastes them into backend/.env by hand. ADR-0014's end state has many users and
servers: self-hosted ones behind home NAT, and managed ones on AWS. Two facts constrain the design:
- GetServerOptions returns the FRM token in plaintext (ADR-0012).
- On the owner's PC, the game's HTTP ports (7777 game API, 8080 FRM) listen on all interfaces, and
  the Windows firewall allows FactoryServer inbound on Private and Public profiles (checked
  2026-09-24). So FRM's token-protected plain-HTTP API is reachable from the local network.

## Decision

### Principle
Game-server credentials never leave the game-server host. The cloud (backend/API + database)
never stores, receives or logs FRM tokens, vanilla tokens or admin passwords. The only
credential the cloud issues and holds is a per-server **agent credential**, stored hashed.

### Self-hosted servers (edge agent, ADR-0014)
- **Setup, on the game host:** `agent setup` reads the FRM token from the local config (or
  generates a new random one and writes it), obtains a vanilla application token locally
  (console or loopback API), and stores both in a local file with owner-only permissions
  (Windows: user ACL/DPAPI; Linux: 0600).
- **Enrollment:** in the dashboard, "Add server" issues a single-use enrollment code (short
  expiry, about 10 min). The agent exchanges it for an agent credential: a random 256-bit secret
  scoped to that one serverId, allowed only to upload snapshots and fetch commands for it. The
  cloud stores a hash (SHA-256 is enough for a high-entropy secret) plus created, rotated and
  last-seen timestamps.
- **Rotation:** the agent credential rotates automatically (e.g. every 30 days, with an overlap
  window). Local game tokens rotate on demand with `agent rotate-local`, which warns that
  InvalidateAPITokens revokes every application token on that server.
- **Revocation:** "Remove server" or "Revoke agent" in the dashboard deletes the hash; the agent's
  next call gets 401 and it stops.
- **Writes (e.g. auto-pause, ADR-0012):** the cloud sends a command ("set autoPause=true") over
  the agent's outbound channel. The agent executes it locally with its own token. So the ADR-0012
  write path moves from backend -> game server to cloud -> agent command when the agent arrives.
- **Upload filter:** the agent uploads only data parsed through the shared snapshot schemas
  (unknown keys stripped). The GetServerOptions allowlist adapter moves into the agent unchanged,
  so raw options output is never uploaded.

### Managed servers (provisioning service, ADR-0014)
- **Generation:** at create time the provisioning service generates the FRM token and admin
  password (random). The on-host agent obtains the application token locally after first boot.
- **Storage:** AWS Secrets Manager, one secret per server (e.g. `satis/servers/{id}`), encrypted
  with KMS. Readable only by that server's instance role (an IAM policy scoped to its own path)
  and the provisioning service. The web API and Postgres hold only the secret's ARN, never values.
- **Rotation, automated:** a scheduled job rotates during idle or stopped windows: new FRM token
  -> config -> mod restart if required [NEEDS VERIFICATION: whether FRM picks up a new token
  without a restart]; plus a new application token, then invalidating the old ones.
- **Revocation and deletion:** deleting a server revokes its agent credential, deletes its secret
  (with a recovery window) and terminates the instance.
- **Customer access** to their server's admin password: an explicit, audited "reveal" action,
  never shown in lists or logs.

### What the cloud may hold
| Store | May hold | Must never hold |
|---|---|---|
| Postgres | users (password hash or IdP id), servers (id, owner, name, mode), agent-credential hash + timestamps, secret ARNs (managed) | FRM token, vanilla token, admin password, raw GetServerOptions |
| Logs | audit events (enroll, rotate, revoke, reveal) with ids | any credential value (pino redaction plus tests with fake tokens, as in ADR-0012) |

### Today (single operator, backend co-located with the game server)
- backend/.env on the game PC holding the tokens is consistent with the principle: the
  co-located backend is effectively the agent. The owner deferred rotating the FRM token (it was
  displayed once in a local session transcript), since the tunnel exposes only the backend.
- **Do now (cheap, independent of rotation):** block inbound TCP 8080 (FRM) except from this PC.
  Add a Windows Firewall inbound BLOCK rule for TCP 8080 (block beats allow), or narrow the
  FactoryServer allow rules to UDP/TCP 7777. FRM is plain HTTP, and the backend only needs it on
  loopback. Keep TCP/UDP 7777 open for game clients.

## Consequences
- The cloud has no game credentials to leak, which means a smaller breach blast radius and less
  compliance scope.
- Agent setup becomes the one place that handles game tokens, and must be simple for
  non-technical users.
- Managed hosting depends on Secrets Manager and KMS (a small monthly cost per secret).

## Build triggers
| Piece | Trigger |
|---|---|
| Firewall block on 8080 | now (manual, owner) |
| Agent credential + enrollment + revocation | built with the edge agent (ADR-0014: the first server the backend can't reach on loopback) |
| Automated agent-credential rotation | the first external user's server enrolls |
| Secrets Manager + automated game-token rotation | managed hosting approved |
| Audited "reveal admin password" | the first managed-hosting customer |

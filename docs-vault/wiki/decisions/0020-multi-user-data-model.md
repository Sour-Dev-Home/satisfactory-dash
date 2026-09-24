# ADR-0020: Multi-user accounts, server onboarding and data model

Status: accepted (project owner), 2026-09-24

## Context
Today: one operator from .env (ADR-0011); stateless cookie sessions (ADR-0019); a "registry of
one" (ADR-0001); no database (ADR-0009); the backend co-located with the only game server
(ADR-0013). The target (ADR-0014/0017) is many users, each with several servers, fed by an edge
agent beside each server, plus optional managed hosting. This ADR fixes the data model, the
consistency rules, and which interactions are sync or async, so the first multi-user PRs follow
one plan. Nothing here is built until its trigger fires.

## Decision

### Sign-up and login
- **Sign-up** via OpenID Connect, **Google only** at launch (owner decision). Other providers are additive identity rows.
  No passwords to store, and no email pipeline needed for verification or resets.
  Email+password can be added later as another identity type.
- **Login** via server-side sessions in Postgres (ADR-0019's scaling row): an opaque random id in
  the same HttpOnly, Secure, SameSite=Lax cookie; the table stores only a hash of the id. Logout
  and "sign out everywhere" become real deletes. The Origin/CSRF and rate-limit rules stay (the
  limiter moves to a shared store).
- **Single-operator mode** keeps working: the .env operator becomes a seeded user.

### Servers, onboarding, multiple servers per user
- **One user, many servers; one server, many users:** a membership table with roles:
  - owner: exactly one, enforced with a partial unique index
  - admin: can toggle settings
  - viewer: read-only
  Sharing a server with friends is then an insert, not a redesign.
- **Onboarding (self-hosted):** "Add server" creates the server and the owner membership in one
  transaction, and shows a single-use enrollment code. The user installs the agent next to the
  game server and runs `agent enroll <code>`. The code is consumed atomically:
  `UPDATE enrollment_codes SET used_at = now() WHERE code_hash = $1 AND used_at IS NULL AND
  expires_at > now() RETURNING server_id`, so a double submit can't enroll twice. The agent gets
  its per-server credential (ADR-0017), stored hashed.
- **Onboarding (managed):** the provisioning service creates the same rows and enrolls the agent
  it installs itself. It's an async workflow (below).
- **Public server ids:** 20-character lowercase random base32 strings. They fit the existing
  contract (`^[a-z0-9-]{1,32}$`, packages/shared/src/ids.ts:6), so no contract change and
  nothing guessable. Internal primary keys can be UUIDs.
- **Authorization:** every /api/servers/:id route resolves membership for the session's user in
  the repository query. A non-member gets 404 server_not_found (existence isn't leaked). A member
  without the needed role gets 403 `forbidden`, a new KnownErrorCode (additive).
  Repositories always scope by user; Postgres row-level security is an optional later layer.

### Database: PostgreSQL (ADR-0009), one schema per module (ADR-0014)
| Table | Purpose | Key constraints |
|---|---|---|
| users | account | id; status |
| auth_identities | OAuth link | unique(provider, provider_subject) |
| sessions | server-side sessions | id_hash pk; expires_at; revoked_at |
| servers | registry | public_id unique; hosting_mode (self/managed); deleted_at |
| server_members | many-to-many + role | pk(server_id, user_id); one owner per server |
| enrollment_codes | one-time onboarding | code_hash pk; expires_at; used_at |
| agent_credentials | per-server agent auth | secret_hash; revoked_at; last_seen_at; agent_version |
| latest_snapshots | what the UI reads | pk(server_id, kind); observed_at; payload jsonb |
| snapshot_history | charts and alerts (later) | time-partitioned; retention and rollups (ADR-0009) |
| commands | writes to game servers | status pending/sent/succeeded/failed/expired |
| audit_events | security trail | actor, server, action, at |
Why relational: accounts, ownership and permissions need uniqueness, foreign keys and
multi-row ACID transactions. Snapshot payloads are JSONB, since they're already validated
against the shared zod schemas on the way in.

### ACID: where transactions matter
- **Sign-up:** user + identity + session in one transaction.
- **Add server:** server + owner membership + enrollment code.
- **Enroll:** consume the code and create the credential atomically (the guarded UPDATE above).
- **Delete server:** revoke the credential, delete members, codes, commands and snapshots, soft-delete
  the server, and write an audit row.
- **Transfer ownership:** swap roles in one transaction; the one-owner index holds throughout.
- **Snapshot ingest does NOT need multi-row transactions.** It's a single-row upsert with
  last-write-wins on observed_at:
  `... ON CONFLICT (server_id, kind) DO UPDATE ... WHERE excluded.observed_at > latest_snapshots.observed_at`,
  so a delayed older upload never overwrites newer data.

### Sync vs async
| Interaction | Mode | Why |
|---|---|---|
| Sign-up/login, server CRUD, members, enrollment | sync request/response | the user waits for the result; short and transactional |
| UI reads (status/power/factory) | sync from the database, never from the game server | reads cost O(DB), not O(game servers); the stale flag comes from observed_at (ADR-0004) |
| Agent -> cloud ingest | async push on the agent's schedule (e.g. status/power every 10 s, factory every 30 s) | the game server sits behind NAT; the agent owns the cadence |
| Cloud -> browser updates | async push over SSE (ADR-0005's reserved envelope) | fed by Postgres LISTEN/NOTIFY on one instance; Redis pub/sub at >1 API instance |
| Settings writes (auto-pause) | async command: POST -> 202 + command id -> the agent long-polls, executes, reports -> the UI sees it via SSE/poll; expires (about 60 s) if the agent is offline | the cloud never holds game credentials (ADR-0017) |
| Managed provisioning | async workflow (jobs table + worker; Step Functions if it grows) | minutes long; must be retryable and resumable |
| Emails (only if email+password is added) | async via a transactional outbox table + worker | sign-up must not fail because the mail provider is slow |

### API sketch (REST, additive to the contract)
- Users: /api/auth/* (+ OAuth callback routes)
- Servers: GET/POST /api/servers; PATCH/DELETE /api/servers/:id;
  POST /api/servers/:id/enrollment-codes; DELETE /api/servers/:id/agent (revoke);
  GET/POST/PATCH/DELETE /api/servers/:id/members
- Commands: POST /api/servers/:id/settings/auto-pause returns 202 + command;
  GET /api/servers/:id/commands/:cid
- Agent API (separate path prefix and credential): POST /agent/v1/snapshots;
  GET /agent/v1/commands (long-poll); POST /agent/v1/commands/:cid/result
Contract impact: the settings write moves from 200 to 202 + command resource (a breaking change,
handled with expand -> migrate -> contract per ADR-0007); `forbidden` is new; there are
member/server CRUD schemas; the agent protocol schemas live in packages/shared.

### Scale envelope (owner decision: at most 5,000 users)
- **Accounts, sessions and memberships** at 5,000 users are trivial for one small Postgres
  instance (RDS on AWS); no sharding, replicas or partitioning needed for them.
- **The real load is ingest, not users.** Worst case, 5,000 connected servers each uploading a
  ~100 KB mapped factory snapshot every 30 s (measured size, ADR-0010) is about 17 MB/s of JSONB
  rewrites. That's too much to accept blindly on one primary.
- Rule: **viewer-driven cadence**. Agents upload at a low idle rate (status/power about every
  60 s, factory about every 5 min). The cloud tells an agent over its command channel to switch
  to the live rate (10 s / 30 s) only while at least one browser is watching that server (an
  SSE subscription exists), and reverts after the last viewer leaves. Load then scales with
  active viewers, not with registered servers. (This replaces the fixed cadence in the sync/async
  table above.)
- Store the latest factory payload compressed. Keep history as rollups, not full snapshots
  (ADR-0009).
- **SSE:** a few hundred concurrent viewers fit one Node instance. Revisit at measured
  connection pressure (then Redis pub/sub + more than one API instance).

## Consequences
- One Postgres serves everything at this scale. There's one store to operate, and ACID where
  it matters.
- UI latency and game-server load are decoupled: viewers read the database, and only agents
  touch game servers.
- Settings writes become eventually consistent (seconds), shown as pending in the UI.

## Triggers
| Build | When |
|---|---|
| Postgres + users/sessions/servers/members | the first account beyond the owner |
| Agent + enrollment + ingest + latest_snapshots + SSE | the first server not on the owner's PC (with ADR-0014's agent) |
| Commands (async writes) | with the agent (a direct write is impossible across NAT) |
| snapshot_history | the first history or alert feature |
| Redis (pub/sub, limiter) | more than one API instance |
| Row-level security | when a second developer or service writes SQL |

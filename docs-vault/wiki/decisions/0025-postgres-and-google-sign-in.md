# ADR-0025: Postgres, Google sign-in and the DB registry (ADR-0020 phase 1)

Status: accepted (project owner), 2026-09-24, except decision 7 (query layer), which is open.
PRs 1-2 may start; PR 3 onward waits on decision 7.

## Context
- ADR-0020 fixes the data model (users, auth_identities, sessions, servers, server_members) but
  not where Postgres runs, the tooling, or the order of work. This ADR does.
- Today: one operator from .env with a password hash (`identity/authenticator.ts:28`); a stateless
  HMAC cookie with an in-memory logout denylist, where rotating SESSION_SECRET is the revoke-all
  (`identity/sessionToken.ts:3-12`, `identity/sessionDenylist.ts`); a registry of one from env
  (`servers/serverRegistry.ts:14`); `ServerDirectory` maps a server id to live connection services
  (`servers/serverDirectory.ts:15`). The backend is a hand-started `node dist\server.cjs` on the
  game PC behind the Cloudflare Tunnel (ADR-0013; runbooks/go-live-api.md:110).
- The key seam: until the edge agent exists, **how to reach a game server** (host, ports, tokens)
  stays in local config and secrets. **Who may see it** (servers, members, roles) moves to Postgres.
  The two are joined by the public server id.

## Decision
1. **Postgres 18** everywhere (18.6 current). One schema per module (`identity`, `servers`,
   `audit`), per ADR-0014.
   - Dev: Docker Compose, bound to 127.0.0.1.
   - CI and tests: Testcontainers; Docker is preinstalled on ubuntu-latest, so no service block.
   - Prod (phase 1): **local on the game PC, as the native PostgreSQL 18 Windows service**
     (starts automatically at boot, `listen_addresses = 'localhost'`, scram-sha-256 in
     pg_hba.conf). The DB sits beside the only process that uses it. It adds no new network
     exposure and costs $0. Backups go off-machine (item 7). Docker Desktop is not used in prod: it
     is set not to start at sign-in (to save RAM), so after a reboot a Docker-hosted DB would stay
     down while the backend's Scheduled Task starts without it.
     - Parity with dev/CI (Linux containers): the same major version, and every database created
       with `LOCALE_PROVIDER builtin` and `BUILTIN_LOCALE 'C.UTF-8'` in all three environments, so
       sorting and comparison don't differ between Windows and Linux. Minor updates (18.x, roughly
       quarterly, often security fixes) are a runbook step.
   - Portable by construction: `DATABASE_URL` only, TLS-capable (`sslmode=verify-full` when
     remote), no Docker-only features. Moving to RDS is pg_dump/restore plus a connection string,
     done **together with** the API's move to AWS (ADR-0014 target), not before.

   | Prod option | Cost | Ops burden | Fit with the tunnel topology |
   |---|---|---|---|
   | Local, native Windows service (recommended) | $0 | backups and minor upgrades are ours; starts at boot | loopback, nothing new exposed |
   | Local, Docker Desktop | $0 | as above, plus Docker Desktop must auto-start at sign-in (it holds a WSL2 VM's RAM) and the backend task must wait for it | loopback; boot-order fragile |
   | Neon free | $0: 0.5 GB, 100 CU-h/month, scales to zero after 5 min | minimal | DB over the internet; a session lookup per request pays a WAN round trip plus cold starts [NEEDS VERIFICATION: measure] |
   | Supabase free | $0 | minimal | bundles its own auth/platform we wouldn't use; no gain over Neon |
   | RDS db.t4g.micro | ~$12/month on demand + storage (accounts made after 2025-07-15 get a credit-based free plan of up to 6 months) | low | poor today: needs a public endpoint allowlisted to a dynamic home IP. The right choice once the API runs in AWS |

2. **Tooling**
   - `pg` (node-postgres): the standard driver, one pool in `platform/db`.
   - **Kysely** as the query layer: typed SQL that still reads as SQL, with no ORM runtime or
     codegen engine. Prisma hides the SQL, which is the skill we want visible. Drizzle is close,
     but its migrations are generated from a TS schema; we want the DDL written by hand.
   - **node-pg-migrate with plain `.sql` migrations**: forward-only in prod, run as an explicit
     `npm run db:migrate` step (never at app startup).
   - **Two roles**: `satis_migrator` (DDL) and `satis_app` (DML on the three schemas only).
   - **Tests use a real DB**: Vitest globalSetup starts one Postgres container per run and migrates
     it once; each test file gets a fresh database cloned from the migrated template
     (`CREATE DATABASE ... TEMPLATE`). No mocked repositories in the integration tests.
3. **Google OIDC with `openid-client` v6** (panva, certified OpenID relying party).
   - Flow: `GET /api/auth/google/start` creates a row in `identity.login_attempts` (state, nonce,
     PKCE verifier, return path, 10-minute expiry), sets a cookie holding only its random id, and
     returns 302 to Google.
   - `GET /api/auth/google/callback` consumes the attempt with a guarded
     `DELETE ... WHERE id_hash = $1 AND expires_at > now() RETURNING *` (single use, same pattern
     as ADR-0020's enrollment codes), then calls `authorizationCodeGrant` with `pkceCodeVerifier`,
     `expectedState` and `expectedNonce`.
   - An identity is keyed on `(provider, sub)`, **never on email**. Sign-up, identity and session
     are created in one transaction. The return path is a relative `/app...` path only.
   - Redirect URIs: `https://api.satis-manager.com/api/auth/google/callback`, plus
     `http://localhost:5173/api/auth/google/callback` for dev through the Vite proxy.
   - Scopes `openid email` only: no profile photo, so img-src doesn't change. `GOOGLE_CLIENT_ID`
     and `GOOGLE_CLIENT_SECRET` live in the backend .env only.
   **Owner setup in Google Cloud Console** (before PR 7; the console labels may differ slightly
   [NEEDS VERIFICATION at setup time]):
   1. Create a project (e.g. "satis-manager").
   2. Google Auth Platform, Get started: app name "Satis Manager", support email = the project's
      contact@ address (not a personal one), audience **External**.
   3. Branding: home page https://satis-manager.com, privacy policy URL (the page must exist),
      authorized domain `satis-manager.com`.
   4. Data access: scopes `openid` and `.../auth/userinfo.email` only (non-sensitive, so no
      Google review for scopes).
   5. Clients, Create client, **Web application**: add the two redirect URIs above. No JavaScript
      origins are needed (the flow is server-side).
   6. Put the client ID and secret into the backend .env on the PC. Never commit them or paste
      them into chat.
   7. Audience: **Publish app** (while it's in "Testing", only listed test users can sign in).
      Keep it in Testing, with the owner as a test user, until gate B.
4. **Server-side sessions**: a 32-byte random id in the same cookie (name and flags unchanged).
   `identity.sessions` stores `sha256(id)`, user_id, expires_at, revoked_at and last_seen_at
   (written at most once a minute). There's a new id on every login (no fixation) and the same
   8-hour absolute lifetime. Logout sets revoked_at. **Revoke-all stays**: per user from the
   account menu, and for everyone with `npm run admin -- revoke-sessions --all`, which replaces
   rotating SESSION_SECRET. The in-memory denylist is deleted.
5. **No lockout during the migration**
   - Deploy A seeds the .env operator as a user (a `local` identity) that owns every configured
     server. Password login keeps working, now backed by DB sessions.
   - Deploy B: the first Google sign-in with `email_verified = true` and an email equal to
     `BOOTSTRAP_OWNER_EMAIL` (in .env, never committed) **links** the Google identity to that same
     user, so memberships carry over.
   - The password identity is removed only after the owner confirms Google sign-in works (PR 9).
   - Break-glass: `npm run admin -- grant-owner --email ...`, run locally against the DB. Shell
     access to the PC is the trust boundary.
6. **DB availability: startup, runtime, health**
   - Startup classifies the first connection error:
     - **Retry with backoff** only on transient errors: connection refused/reset, and SQLSTATE
       57P03 ("the database system is starting up", the boot race). Backoff runs 1 s doubling to
       30 s, with a 5-minute deadline, logging each attempt. After the deadline it exits 1, so the
       Scheduled Task's "restart on failure" setting takes over and a broken setup still fails loudly.
     - **Fail fast (exit 1, clear message)** on configuration errors: a malformed DATABASE_URL,
       bad credentials (28P01), a missing database (3D000), or **a schema behind the code**. The
       app compares the migrations table with the newest migration bundled in the build and says
       "run npm run db:migrate". It never migrates itself.
   - Liveness answers from the start, so the process is visibly up while waiting.
   - Runtime: the backend never exits on DB errors. The pg pool reconnects on demand. DB-dependent
     requests return **503 `service_unavailable`** (a new additive error code). A session lookup
     that fails because the DB is down is a 503, **never a 401**: an outage must not look like
     "signed out" to the frontend.
   - Health: `/api/health` stays liveness (process up). The new `/api/health/ready` returns 200 or
     503 with `{ status: "ok" | "unavailable" }` from a `SELECT 1` with a 1 s timeout. The body
     gives no detail about which dependency failed (it's public). The planned uptime monitor
     watches `/ready`.
7. **Backups**: a nightly `pg_dump -Fc` (Windows scheduled task), encrypted on the PC with `age` to
   a public key (the private key stays offline in the owner's password manager, so neither the PC
   nor a leaked AWS key can read old backups), uploaded to a private S3 bucket in the **owner's own
   AWS account**. **No session provisions AWS resources**: the owner performs the steps below from
   runbooks/backups.md. Size: the dumps are well under 1 MB, so 30 days costs effectively $0.
   A restore is rehearsed once before deploy B.
   1. Check the account's plan. Accounts created before 2025-07-15 keep the legacy 12-month free
      tier. Newer accounts get a credit-based Free plan that ends after 6 months or when the
      credits run out [NEEDS VERIFICATION: what happens to stored data when it ends]. Backups must
      not live in an account that can lapse: upgrade to the Paid plan before relying on them (the
      cost stays cents).
   2. Budgets: a $1/month cost budget with an email alert.
   3. S3: one bucket with Block Public Access on (the default), versioning on, default encryption
      SSE-S3, and a lifecycle rule that expires current objects after 30 days and noncurrent
      versions after 7.
   4. IAM: a policy allowing **only `s3:PutObject`** on `arn:aws:s3:::<bucket>/satis-dash/*` (no
      Get, List or Delete, so a compromised PC can't read or erase backups), attached to a user
      `satis-backup` with no console access. Create one access key into a named AWS CLI profile on
      the PC, never into the repo or chat. Rotate it every 90 days.
   5. Restore rehearsal: download as the owner's admin identity (not the put-only user), `age -d`,
      `pg_restore` into a scratch DB, then check readiness.

## Build plan (merge order; dev = satisfactory-dash-dev, fe = satisfactory-dash-frontend, dc = coordinator)
| # | PR | Owner | Test-hunter |
|---|---|---|---|
| 0 | This ADR (docs) | dev commits | skip |
| 1 | Multiple servers from config: one git-ignored JSON file (`SATISFACTORY_SERVERS_FILE`, the same protection as .env), with per-server id, name, host, ports and tokens, zod-validated at startup, replacing the single SATISFACTORY_* config shared by the registry in server.ts. Each entry keeps its own telemetry bundle and power-history poller (no DB) | dev | QUICK |
| 2 | DB foundation: compose file for dev (dc), `platform/db` pool + env validation, startup classification and backoff, schema-version check, `/api/health/ready`, node-pg-migrate + roles, Testcontainers harness, workspace.dsl gains the Database container (the drift check runs). Prod install of the native service and the runbook start order (dc) | dev + dc | FULL (startup error classification is logic) |
| 3 | Schema + repositories: users, auth_identities, login_attempts, sessions, servers, server_members (one-owner partial unique index), audit_events; constraint tests | dev | FULL |
| 4 | Contract (additive, optional fields): `forbidden` and `service_unavailable` error codes, the readiness response schema, SessionResponse gains `email?` and `authMethods?`, revoke-all endpoint schema | dev | skip |
| 5 | DB sessions. The HTTP contract and IdentityModule's public shape stay; inside, the session lookup (requestSession, currentUser, isActiveUser) becomes async, and createIdentityModule receives the pool from server.ts (the composition root). `res.locals.user` gains `id` (additive; PR 6 needs it). Operator seeded; admin CLI (revoke-sessions); denylist removed | dev | FULL + security-reviewer |
| 6 | DB registry + membership: an async `authorizeServer` middleware mounted on `/api/servers/:serverId` looks up the membership (non-member 404, which doesn't reveal existence) and sets `res.locals.serverRole`; `resolveServer` stays synchronous, so its 6 call sites don't change; writes check the role (403 `forbidden`); `GET /api/servers` becomes a per-user list. Configured servers are upserted at startup. **IDOR tests are generated from the shared endpoints list**, so a new server-scoped route can't skip the check | dev | FULL + security-reviewer |
| | **Gate A: owner approves, then deploy A (DB, password login still)** | | |
| 7 | Google OIDC start/callback, bootstrap link, closed sign-up, rate limit on /start | dev | FULL + security-reviewer |
| 8 | Login page: "Sign in with Google" (a plain navigation); account menu with "sign out everywhere" | fe | QUICK + ui-reviewer |
| 8b | Backup script (pg_dump, age, upload with the put-only profile) + runbooks/backups.md with the owner's AWS steps; scheduled-task registration (dc) | dev + dc | QUICK |
| | **Gate B: owner approves, then deploy B (Google)** | | |
| 9 | Cleanup: remove the password identity/login, the stateless-token code and SESSION_SECRET if unused; mark ADR-0011/0019 as superseded where they are | dev | QUICK |
| 1b | Later: members API (invite by email, consumed on the first verified sign-in) + members UI | dev, fe | FULL / QUICK |

PR 1 comes first because it separates "how to reach" from "who may see", which PR 6 needs, and
it's testable without a DB. It is useful only if more than one game server will exist; if not,
fold its interface change into PR 6.

## Security review points (checked by security-reviewer on PRs 5, 6, 7)
- OIDC: state + nonce + PKCE all checked; exact redirect URIs; ID token validated by the library;
  identities by `sub`; `email_verified` required for the bootstrap link and invites; no open
  redirect (relative `/app` paths only).
- Sessions: 256-bit ids hashed at rest, rotated on login, real revocation, cookie flags unchanged,
  Origin/CSRF checks unchanged.
- Authorization: membership in the repository query. IDOR tests: user B gets a 404 for A's server
  on every route.
- SQL: parameters only; a lint/grep guard against `sql.raw` built from input. `satis_app` has no DDL.
- Postgres on loopback only; a strong generated password; DATABASE_URL in .env.
- PII: the DB now stores emails. Never log emails, tokens or cookies (pino redact). Encrypted
  backups. The privacy page states what's stored. Account deletion ships with 1b at the latest.
- Audit rows: login, logout, revoke-all, grant-owner, membership changes.

## Go-live gates (a major auth change: owner approval at start, and before each deploy)
- Each gate needs: all PRs merged with the listed tiers green; a security-reviewer pass on the
  combined diff; migrations run on a fresh DB and on a restored backup; the runbook updated
  (start order: Postgres, migrate, backend); rollback = the previous build + the previous .env
  (schema changes are additive, so the old build ignores them).
- Gate B also needs: a Google sign-in tested on localhost and in prod by the owner; revoke-all
  tested; a backup restore rehearsed; e2e against a mock OIDC provider container (never real Google).

## Owner decisions (answered 2026-09-24)
1 yes (start phase 1). 2 A: native Windows service; Docker Desktop now starts at sign-in, understood as a dev convenience (being confirmed).
3 yes (two-stage rollout). 4 A: closed sign-up. 5 no permanent password fallback. 6 yes, as
owner-performed steps (Decision 7). 7 OPEN (Kysely vs raw pg; the owner is discussing it with
the architect). 8 yes, PR 1 is its own PR.

## Decisions as proposed
1. Go ahead with phase 1 now? **Recommend yes**: the trigger is "the first account beyond the
   owner", and sharing (1b) is what makes that happen.
2. Prod Postgres: **A local, native Windows service (recommended; "2A-bis")** / A2 local Docker
   Desktop set to auto-start, plus a backend task that waits for it / B Neon / C RDS now.
3. Two-stage rollout (deploy A, then deploy B)? **Recommend yes**.
4. Sign-up: **A closed: owner plus invited emails (recommended)** / B open to any Google account.
   Open sign-up waits for the agent, since there's nothing to show a stranger yet.
5. Keep password login as a permanent fallback? **Recommend no**: the local admin CLI is the break-glass.
6. Nightly encrypted backups to S3 (cents per month)? **Recommend yes**.
7. Query layer: **A Kysely (recommended)** / B raw `pg` SQL with zod-parsed rows (fewer deps, more boilerplate).
8. PR 1 (multiple servers from config): will a second game server exist soon? If yes, keep it; if no, fold it into PR 6.

## Consequences
- The project gains visible SQL: hand-written DDL, constraints, guarded single-use updates, roles
  and migrations, all tested against a real Postgres in CI.
- One more local process to run (Postgres). The runbook's start order changes.
- Users sign in again once at deploy A (the old stateless cookies stop working).

## Revisit when
- The API moves to AWS (ADR-0014): move the DB to RDS in the same change.
- There's more than one API instance: the login limiter and SSE fan-out move to Redis (ADR-0020).
- There are measured WAN or DB latency problems.

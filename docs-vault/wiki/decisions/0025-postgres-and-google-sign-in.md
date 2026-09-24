# ADR-0025: Postgres, Google sign-in and the DB registry (ADR-0020 phase 1)

Status: proposed (architect), 2026-09-24. Needs the owner's decisions (last section) before any build.

## Context
- ADR-0020 fixes the data model (users, auth_identities, sessions, servers, server_members) but
  not where Postgres runs, the tooling, or the order of work. This ADR does.
- Today: one operator from .env with a password hash (`identity/authenticator.ts:29`); a stateless
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
   - Prod (phase 1): **local on the game PC** (Docker, loopback only). The DB sits beside the only
     process that uses it. It adds no new network exposure, costs $0, and is up exactly when the
     API is. Backups go off-machine (item 6).
   - Portable by construction: `DATABASE_URL` only, TLS-capable (`sslmode=verify-full` when
     remote), no Docker-only features. Moving to RDS is pg_dump/restore plus a connection string,
     done **together with** the API's move to AWS (ADR-0014 target), not before.

   | Prod option | Cost | Ops burden | Fit with the tunnel topology |
   |---|---|---|---|
   | Local Docker (recommended) | $0 | backups and upgrades are ours; Docker Desktop must be running | loopback, nothing new exposed |
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
6. **Backups**: a nightly `pg_dump` (Windows scheduled task), encrypted, to a private S3 bucket
   with SSE and a 30-day lifecycle rule, uploaded by a put-only IAM user (cents per month; the
   first AWS resource). A restore is rehearsed once before deploy B.

## Build plan (merge order; dev = satisfactory-dash-dev, fe = satisfactory-dash-frontend, dc = coordinator)
| # | PR | Owner | Test-hunter |
|---|---|---|---|
| 0 | This ADR (docs) | dev commits | skip |
| 1 | Multiple servers from config: connection entries keyed by server id feed `ServerDirectory` (no DB) | dev | QUICK |
| 2 | DB foundation: compose file (dc), `platform/db` pool + env validation, node-pg-migrate + roles, Testcontainers harness, readiness checks the DB, workspace.dsl gains the Database container (the drift check runs) | dev + dc | QUICK |
| 3 | Schema + repositories: users, auth_identities, login_attempts, sessions, servers, server_members (one-owner partial unique index), audit_events; constraint tests | dev | FULL |
| 4 | Contract (additive, optional fields): `forbidden` error code, SessionResponse gains `email?` and `authMethods?`, revoke-all endpoint schema | dev | skip |
| 5 | DB sessions behind the existing session interface; operator seeded; admin CLI (revoke-sessions); denylist removed | dev | FULL + security-reviewer |
| 6 | DB registry + membership authorization in `resolveServer` (non-member 404, wrong role 403); configured servers upserted at startup | dev | FULL + security-reviewer |
| | **Gate A: owner approves, then deploy A (DB, password login still)** | | |
| 7 | Google OIDC start/callback, bootstrap link, closed sign-up, rate limit on /start | dev | FULL + security-reviewer |
| 8 | Login page: "Sign in with Google" (a plain navigation); account menu with "sign out everywhere" | fe | QUICK + ui-reviewer |
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

## Decisions for the owner
1. Go ahead with phase 1 now? **Recommend yes**: the trigger is "the first account beyond the
   owner", and sharing (1b) is what makes that happen.
2. Prod Postgres: **A local Docker on the game PC (recommended)** / B Neon / C RDS now.
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

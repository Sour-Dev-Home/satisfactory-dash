# Database (ADR-0025, phase 1 foundation)

Postgres 18 holds users, sessions and the server registry from deploy A onward (ADR-0020,
ADR-0025). This page covers what exists after PR 2: the connection, the two roles, migrations,
readiness and the tests. Nothing reads or writes application data yet (tables arrive in PR 3), and
without `DATABASE_URL` the backend behaves exactly as before.

## Environment (backend `.env`)

| Variable | Meaning |
|---|---|
| `DATABASE_URL` | `postgres://satis_app:<password>@localhost:5432/satis` (add `?sslmode=verify-full` for a remote database). Unset or blank = no database. Never commit it or paste it into chat. |
| `DATABASE_POOL_MAX` | Pool size, 1-100 (default 10) |
| `DATABASE_STATEMENT_TIMEOUT_MS` | Server-side statement timeout, 100-120000 (default 10000) |

The backend connects as `satis_app` (DML on the `identity`, `servers` and `audit` schemas, never
DDL). Migrations run as `satis_migrator`, the database owner.

## One-time setup and migrations

Start order: **Postgres, `npm run db:migrate`, backend.** The backend never migrates itself.

```powershell
# 1. Once, with a Postgres superuser (idempotent; the passwords are never printed).
$env:DATABASE_ADMIN_URL   = "postgres://postgres:<admin password>@localhost:5432/postgres"
$env:DB_MIGRATOR_PASSWORD = "<16+ characters>"
$env:DB_APP_PASSWORD      = "<16+ characters, different>"
npm run db:init -w backend        # roles + database with the builtin C.UTF-8 locale

# 2. After every pull that adds a migration (forward-only).
$env:MIGRATOR_DATABASE_URL = "postgres://satis_migrator:<password>@localhost:5432/satis"
npm run db:migrate -w backend
```

Every database is created with `LOCALE_PROVIDER builtin` and `BUILTIN_LOCALE 'C.UTF-8'` in every
environment (Windows service, dev, CI), so sorting and comparison never differ. Migrations are
plain `.sql` files in `backend\migrations\` (`<timestamp>_<name>.sql`, an `-- Up Migration`
section). When you add one, update `LATEST_MIGRATION` in `platform/db/latestMigration.ts`; a test
fails if the two disagree.

## What the backend does with the database

- **Startup**: the process listens first (liveness answers at once), then connects in the
  background. A **transient** error (connection refused or reset, SQLSTATE 57P03 "starting up")
  is retried with backoff (1 s doubling to 30 s) for up to 5 minutes, then the process exits 1 so
  the Scheduled Task's restart-on-failure takes over. A **setup** error exits 1 at once with a
  clear message: wrong credentials, a missing database, or a **schema behind this build** ("run
  `npm run db:migrate`"). A schema *ahead* of the build is accepted (changes are additive, so the
  previous build still works: that is the rollback path).
- **Runtime**: the backend never exits on a database error; the pool reconnects on demand.
- **Health**: `/api/health` is liveness (the process is up, never touches a dependency).
  `/api/health/ready` runs `SELECT 1` with a 1 s timeout and answers `200 {"status":"ok"}` or
  `503 {"status":"unavailable"}` with no detail (it is public). With no `DATABASE_URL` it answers
  200. Its schema joins the shared contract in PR 4.
- Logs: the pool and startup paths carry error codes only, never the URL or the password. The
  request error handler is different: it logs the full cause chain with the request id, so a
  database outage line includes the driver's message (for example a refused connection to
  `127.0.0.1:5432`). The driver's messages do not contain the password or the connection string,
  and that detail is never in a response body (a `service_unavailable` body has none, in any
  environment). Log files stay on the game PC (14-day retention); treat them as internal.

## Tests

The database tests run against a real Postgres 18 in a Testcontainers container: one container
per run, migrated once into a template database that each DB test file clones. Docker Desktop
must be running.

- **CI**: always runs them, and **fails the run if Docker is missing** (it never skips).
- **Locally without Docker**: they skip, with a loud `DATABASE TESTS SKIPPED` line.
- `SKIP_DB_TESTS=1 npx vitest run <file>` skips the container start for a narrow run of unrelated
  tests (ignored when `CI` is set).
- If Docker Desktop is running but a shell can't find it (`spawn docker-credential-desktop
  ENOENT`), add `C:\Program Files\Docker\Docker\resources\bin` to `PATH` (Git Bash:
  `export PATH="$PATH:/c/Program Files/Docker/Docker/resources/bin"`).

## Not covered here

The compose file for dev and the native Windows service install for production are owned by the
coordinator session (ADR-0025 build plan, PR 2).

## Sessions (ADR-0025 PR 5)

With `DATABASE_URL` set, sign-in sessions live in `identity.sessions` instead of signed tokens: the
cookie (same name and flags) holds a 32-byte random id and the table only its sha256, with the same
8-hour lifetime and a new id on every login. Without `DATABASE_URL` the original signed-token
sessions keep working. At the first start with a database, everyone signs in once (old cookies are
answered as signed out and cleared).

- **The operator account** is created on first login with a fixed key (`local` / `operator`); the
  `.env` username is only its display name, so renaming it never creates a second account.
- **A database outage is a 503**, never a 401: the frontend must not treat it as "signed out".
- **Revoking sessions** (replaces rotating `SESSION_SECRET`), run on the PC with `DATABASE_URL` set:

```powershell
npm run admin -- revoke-sessions --all                # sign everyone out
npm run admin -- revoke-sessions --user <user-id>     # one account, everywhere
```

  Each writes an audit row (`sessions.revoke_all` / `sessions.revoke_user`, no actor, counts and ids
  only). Users can sign out everywhere themselves with `POST /api/auth/logout-all`.
- **Retention:** sessions expired more than 30 days ago and stale login attempts are purged at
  startup and then hourly, in batches. Sign-in logs carry the user id, never the username.

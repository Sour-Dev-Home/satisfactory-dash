# Runbook: load testing on the local stack (ADR-0037 step 5, #448)

The load kit runs ADR-0037's three k6 scenarios against a backend on this machine, on its own `satis_load` database,
and turns each run into a committed report under `docs-vault/wiki/perf/`. **Load runs stay on the local stack only**
(owner, 2026-10-19): the ADR's one AWS run before cut-over was dropped once cut-over was done, so the kit has no AWS
target and no override (#449 amends the ADR text).

| Piece | What it is |
|---|---|
| `backend/scripts/load-seed.ts` | creates N servers and M users with sessions in the load database, and enrols an agent per server through the real routes; writes `load/.data/seed.json` (git-ignored) |
| `load/a-baseline.js`, `load/b-target.js`, `load/c-knee.js` | the k6 scenarios; `load/lib/` holds their guards and timing, tested by `load/test/` |
| `scripts/load-report.mjs` | k6 output plus `metrics.series_hourly` → `docs-vault/wiki/perf/<date>-<scenario>.md` and SVG charts |
| `.github/workflows/ci.yml`, job `load-smoke` | scenario (a) for about a minute on every PR, report-only |

## The guards (each is enforced in code and unit-tested)

- **The seed** refuses unless `LOAD_TEST=1` is set and the database name ends in `_load`, checked in `DATABASE_URL`
  and again with `current_database()` once connected. It reads no `.env` file, so a production `DATABASE_URL` in
  `backend/.env` is never picked up. Before writing anything it checks that `LOAD_TARGET` accepts a session made in
  that database, so a seed pointed at the live backend stops at once.
- **k6** (and the seed and the report) refuse any target but `127.0.0.1`, `localhost` or the compose service name
  `backend`. There is no override variable; `TARGET=aws-precutover` does nothing.
- **Payloads** are only the shared fixtures (`agentSnapshotRequestFull` and `agentSnapshotRequestPartial` from
  `packages/shared/fixtures`). The seed seals them with a checksum and k6 refuses a seed file whose payloads differ;
  only `observedAt` is replaced per request.
- **No bypasses.** There is no test-only flag or rate-limit exemption in production code. The seed waits out every
  429 for its Retry-After (enrolment allows 10 a minute, so about a minute per 10 servers), and load grows only by
  adding identities at the real cadence.

**Port.** The live backend on the game-server PC listens on 127.0.0.1:3001. Run the load backend on another port
(3101 below) so the two never meet. Even pointed at the live one by mistake, nothing would be written there: the
seed stops at its session check, and k6's credentials exist only in the load database (every request would be a 401).

## What a run does

- **Agents** push a snapshot every 5 s (status and power), every sixth one with the factory too (30 s). They do not
  long-poll for commands, so the command routes carry no load.
- **Users** poll as the frontend's Overview does (`frontend/src/api/queries.ts`): the session and the server list once,
  then status, players and power every 10 s, the factory every 30 s and the alert badge every 60 s. Each user is a
  viewer of one load server.
- **Scenarios:** (a) 1 agent and 3 users for 10 min; (b) 10 agents and 30 users for 30 min; (c) `KNEE_STEP` more agents
  (default 5) every `KNEE_STEP_SECONDS` (default 120) up to every seeded agent, with 3 users. `SMOKE=1` shortens any
  of them to 1 minute.
- **Thresholds are report-only**: snapshot p95 under 1 s and errors under 1%. k6 exits **99** when one is crossed;
  that is a finding for the report, not a failed run. Scenario (c) uses them to stop itself once the knee is passed
  (the cumulative values, a minute late at most); the report finds the exact minute from the timeline.

## 1. Start the local stack

Needs Docker Desktop, Node 22+ with `npm ci` done, and k6 2.3.0 (`winget install k6 --version 2.3.0`, or the
[release](https://github.com/grafana/k6/releases/tag/v2.3.0)). A k6 container cannot reach the host's 127.0.0.1 on
Docker Desktop, and the guard allows no other name, so use the native binary.

Git Bash, from the repository root. The passwords are throwaway; the database is deleted at the end.

```bash
docker run -d --name satis-load-pg -e POSTGRES_PASSWORD=load-only -p 127.0.0.1:55432:5432 postgres:18
export DB_MIGRATOR_PASSWORD=$(openssl rand -hex 24) DB_APP_PASSWORD=$(openssl rand -hex 24)
DATABASE_ADMIN_URL=postgres://postgres:load-only@127.0.0.1:55432/postgres DB_NAME=satis_load npm run db:init -w backend
MIGRATOR_DATABASE_URL=postgres://satis_migrator:$DB_MIGRATOR_PASSWORD@127.0.0.1:55432/satis_load npm run db:migrate -w backend

export DATABASE_URL=postgres://satis_app:$DB_APP_PASSWORD@127.0.0.1:55432/satis_load
export DASHBOARD_ADMIN_USER=load SESSION_SECRET=$(openssl rand -base64 48)
export DASHBOARD_ADMIN_PASSWORD_HASH=$(openssl rand -hex 24 | npm run --silent hash-password -w backend)
npm run build -w backend
HOST=127.0.0.1 PORT=3101 node backend/dist/server.cjs > load-backend.log 2>&1 &
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3101/api/health/ready   # 200 once it is up
```

The variables set here win over any `.env` file. Keep this shell open: the next steps use them.

## 2. Seed

Seed once per run, on a fresh database (step 5 deletes it), so the hourly server-side rows hold only this run.
Sessions last 8 hours, so seed again for a run started later than that.

```bash
export LOAD_TEST=1 LOAD_TARGET=http://127.0.0.1:3101
npx tsx backend/scripts/load-seed.ts --servers 10 --users 30   # (a) needs 1 and 3, (b) 10 and 30, (c) as many servers as the ramp should reach
```

## 3. Run a scenario

```bash
mkdir -p load/results
export LOAD_SINCE=$(date -u +%Y-%m-%dT%H:%M:%SZ)
k6 run --out json=load/results/b.json load/b-target.js      # or a-baseline.js, c-knee.js
export LOAD_UNTIL=$(date -u +%Y-%m-%dT%H:%M:%SZ)
```

For the knee, seed with e.g. `--servers 60` and run `k6 run -e KNEE_STEP=5 -e KNEE_STEP_SECONDS=120 --out json=load/results/c.json load/c-knee.js`.

## 4. Produce the report

Wait at least 70 s after k6 ends (the backend flushes its metrics to `metrics.series_hourly` every 60 s), then:

```bash
node scripts/load-report.mjs --summary load/results/b.json --since "$LOAD_SINCE" --until "$LOAD_UNTIL" --scenario b
```

It writes `docs-vault/wiki/perf/<date>-<scenario>.md` and `<date>-<scenario>-latency.svg` (plus `-knee.svg` for c):
machine and target, the scenario, client-side p50/p95/p99 and errors per route, server-side p50/p95/p99 per route and
per query name (as bucket upper bounds), the agent ingest lag and, for (c), the knee. Every number comes from the two
inputs. The report reads the database through the same `_load` guard (`LOAD_TEST=1`, the `DATABASE_URL` above);
`--rows <file>` takes the rows from a JSON array instead. Reports are committed per milestone, not per run (D4).

## 5. Clean up

```bash
kill %1                               # the load backend (or close the shell)
docker rm -f satis-load-pg            # the container and the whole satis_load database
rm -rf load/.data load/results load-backend.log
```

## CI

The `load-smoke` job in `ci.yml` does steps 1 to 4 on the job's own Postgres service with scenario (a) and
`SMOKE=1`, installs k6 2.3.0 with `grafana/setup-k6-action` (pinned to the v1.2.2 commit), and puts the report in the
job summary and the `load-smoke-report` artifact. k6's 99 never fails it; a broken step does.

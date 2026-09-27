# Backend cheat sheet (for whoever writes backend code or tests)

Facts that cost CI rounds when guessed. Each one names where it comes from; if a source changes, fix this page.

## Two ids for a server

- **Public id**: a string, `^[a-z0-9-]{1,32}$` (ADR-0001). It is the `:serverId` in URLs and `publicId` on `RegisteredServer`
  (`modules/servers/repositories/serverRepository.ts`). Services take this (`switchToLocal(actor, publicId, ...)`).
- **Internal id**: a UUID, `RegisteredServer.id`. Repository functions that touch other tables take THIS
  (`getConnection(db, ring, server.id)`, `lockServerByPublicId` returns it, `agents.*` and history rows key on it).
  Passing a public id there fails with `invalid input syntax for type uuid`.
- Get from one to the other with `findServerByPublicId(db, publicId)`.

## Errors: only some are `ApiFailure`

`platform/errorResponse.ts` holds them. `ApiFailure(code, message, reason?)` carries a stable public `code` (a
`KnownErrorCode`, mapped to a status in `HTTP_STATUS_BY_CODE`). These are plain classes with no `.code`:
`ServerNotFoundError` (unknown server id, and a non-member's view of a server), `ForbiddenError` (member without the
role), `UnauthorizedError`, `ServiceUnavailableError` (503, database down), `RateLimitedError(retryAfterSeconds, message)`,
`BadRequestError`, `NotEditableError`, `InvalidServerIdError`, `UnsupportedMediaTypeError`. A test helper written as
`err instanceof ApiFailure ? err.code : String(err)` therefore returns `"ServerNotFoundError: No server with that id"`
for a missing server; assert `rejects.toBeInstanceOf(ServerNotFoundError)` instead. New refusals with a public code go
through `ApiFailure` and need the code in `packages/shared` errors, `HTTP_STATUS_BY_CODE` and the frontend's `api/errors.ts`.

## Rate limiters bite in tests

`UserRateLimiter({ max, windowMs })` (`platform/userRateLimiter.ts`), keyed by user. Defaults in the code:

| Where | Default |
| --- | --- |
| agents service, enrolment codes (`agentsService.ts`) | 10 per minute per user |
| commands (`commandsService.ts`) | 20 per minute per user |
| agent API: enrol / global enrol / snapshot (`agentApi.ts`) | 10 per minute / 120 per minute / 50 per 10 s |
| agent auth (`agentAuth.ts`) | 600 per minute / 6000 per minute global |
| server management writes (`serverManagementRouter.ts`, `WRITE_LIMIT`) | see `servers.md` (30 per 15 minutes per user) |

A test file that issues many enrolment codes as one user hits the 10 per minute limit at its 11th; every service takes an
optional `limiter` in its deps, so pass `new UserRateLimiter({ max: 1000, windowMs: 60_000 })` there.

## Ordering facts in the servers module

- `createConnection` only inserts for a server whose kind is already `local` (it returns `not_local_server` otherwise), so
  a switch from `agent` flips the kind first, in the same transaction.
- Slow outbound work (the connection test) runs BEFORE the management mutex and the transaction, never under them.
- After a commit, changes to the in-memory runtime (`ServerRuntime`) run under the same management mutex.

## Tests

- DB tests (`*.db.test.ts`) run locally against a Testcontainers Postgres: `npm run test:db -w backend` with Docker Desktop
  running ([`database.md`](./database.md)). Run them before you push; do not use CI for the first run.
- Narrow first: `SKIP_DB_TESTS=1 npm run test -w backend -- <file> --reporter=dot` for a file that needs no database.
- Typecheck and lint with `set -o pipefail; npm run typecheck 2>&1 | tail -5` (and the same for `npm run lint`): read
  tsc's and oxlint's own output. Never send a build, test, git or gh command's stderr to `/dev/null`: that hides auth
  failures and real errors, and a pipe alone reports only the last command's exit code, so `set -o pipefail` matters.

## Waiting on CI (one line)

```
gh pr checks N --watch --interval 45 | tail -3; gh pr checks N | cut -c1-40 | grep -vE "pass|skipping"
```

The first command waits (`--watch` prints every refresh when it is not a terminal, hence `tail`); the second lists every
check that did not pass. Stderr stays visible in both, so an auth or network error from `gh` shows. **No line from the
second command means every check passed** (its exit code is then 1, because `grep -v` found nothing to print; do not read
that as a failure). If it says "no checks reported", `sleep 5` and run it again (the checks have not started yet). Then `gh run view <run-id> --log-failed | tail -40` for a failing one; the run id is in
`gh run list --branch <b>`.

## Git in a worktree session

A session isolated in a worktree refuses a git command it cannot prove stays in the worktree: no `cd X && git ...`, no
`$VAR` or `$(...)` inside a git or gh command, and no chained `git add && git commit && git push`. Run each git command on
its own from the worktree. Never force-push: after a rebase, push under a new branch name, or merge `origin/main` instead.
Run `npm run preflight` before pushing.

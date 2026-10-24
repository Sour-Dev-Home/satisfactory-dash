# Optional remote dev box (`remote-test`, `baselines --local`)

Two developer commands can offload work to a spare Linux machine over SSH. The box is **optional**: with
`DEV_REMOTE_HOST` unset every command behaves exactly as before, and anything that goes wrong with the box falls back
to the normal path. The repo never names the box; it is only an ssh destination or alias in your shell environment.

## Setup (once, on your machine)

- `DEV_REMOTE_HOST` = an ssh destination or alias (for example one from `~/.ssh/config`) that works without a password
  (`ssh -o BatchMode=yes "$DEV_REMOTE_HOST" true`).
- The box needs Linux with git, Node (the repo's version), `flock`, `tar`, and Docker for `--db` and `--local`.
  Everything lives under the remote user's home: a bare repo `~/remote-test.git` and checkouts in `~/remote-test/`.

## `npm run remote-test -- <worktree> [--workspace <ws>]... [--db] [--files <globs...>] [--workers N] [--local] [--no-fallback] [--untracked]`

Runs vitest on the box. The worktree's exact state travels as a commit made with `git stash create` (HEAD plus
uncommitted tracked changes; no branch, index or stash entry of yours is touched), pushed to the bare repo under
`refs/remote-test/<worktree-name>`. New untracked files are **not** included (the command lists them); `--untracked`
ships them too, using a throwaway index. On the box each worktree has its own checkout (a detached git worktree forced
to that commit, `git clean -fdx` except `node_modules`), and `npm ci` runs only when `package-lock.json` changed since
the last run (its hash is kept in `node_modules/.remote-lockhash`). Output streams back and the exit code is vitest's.

- Default workspaces: `backend` with `--db`, otherwise every workspace with tests. `--workers` defaults to 6.
- `--db` sets `REQUIRE_DB=1` and runs `.db.test.ts` files (Docker is the box's own); `--files` narrows what runs.
- `npm run remote-test -- --clean [<name>]` deletes one remote checkout, or all of them with their bare repo.

## `npm run baselines -- <worktree> --local [--only ...] [--commit ...]`

Regenerates the visual baselines on the box instead of dispatching CI. It reads the Playwright image (tag and digest)
from `.github/workflows/e2e.yml`, so it cannot drift from CI, and runs the same steps in it: `CI=true`,
`PLAYWRIGHT_SNAPSHOTS=1`, the version check, `npm ci`, `npm run e2e -w frontend -- --update-snapshots=changed`. Then the
screenshots folder is copied back and applied exactly like the CI path ("applied N of M files; K changed", `--only`,
`--commit`). No push to GitHub is needed. The first run pulls the image and installs; a run takes about 4 minutes
(the whole e2e suite runs, as in CI). A separate checkout (`<name>.pw`) keeps its container-built `node_modules`.

## Trust

The box is less trusted than your PC, and the box decides the remote pass/fail, so CI stays the gate: a green run on
the box never replaces a green CI run. Its output is printed with control characters stripped. The screenshots come
back as a tar stream that `scripts/dev/tarRead.mjs` parses itself: only regular `.png` files with a PNG signature (at
most 10 MB each, 2,000 files, 300 MB in all) are accepted, and anything else (a symlink, hardlink, odd name) rejects the
whole archive and applies nothing. `--untracked` never ships files that `.gitignore` excludes (such as `.env`).

## When things fail

"Anything can fail, including that box."

| Situation | `remote-test` | `baselines --local` |
|---|---|---|
| `DEV_REMOTE_HOST` unset or invalid, box unreachable, push / checkout / `npm ci` / container start fails | one line saying why, then the same tests here with `--maxWorkers=2` (db tests only if local Docker answers); with `--no-fallback`, exit 1 | one line saying why, then the existing CI path (needs the branch pushed) |
| The tests themselves fail | their exit code; never retried locally | "a test failed before the baselines were saved" plus the last output; no CI fallback |

`--local` on `remote-test` skips the box on purpose. The code is in `scripts/dev/remote.mjs` (helpers, unit-tested in
`remote.test.mjs`), `remote-test.mjs` and `baselines.mjs`.

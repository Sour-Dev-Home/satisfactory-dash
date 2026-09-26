# ADR-0033: Delivery workflow: log fragments, a merge queue, and one task board

Status: accepted (owner, 2026-09-25: all of it, with the merge queue after the log fragments)

## Context
- Several sessions open PRs against `main` in parallel. Nearly every PR appends a line to
  `docs-vault/wiki/log.md` (every one of the last 40 commits on `main` touches it; the file is 465
  lines, newest at the bottom). Two open PRs therefore always conflict on the same last lines, which
  causes the "merge main again" loops (e.g. #161 went CONFLICTING on log.md after #159/#160 merged).
- The `main` ruleset requires `verify`, `e2e` and the commit status `fresh-eyes/test-hunter` (from any
  source), with **strict (up-to-date) checks off**. A PR can be green on an old base and still break
  `main` when combined with another green PR. Screenshot baselines are the usual case: two UI PRs change
  the same card, and each carries baselines rendered without the other.
- The fresh-eyes status is posted by a session on the PR's head SHA (WORKFLOW.md, "Make it visible").
- Tasks live in chat, WORKFLOW.md open items and ARCHITECTURE.md. There is no single queue.
- The repo is public and owned by an organization on the free plan (GitHub API). Merge queues are
  offered for public repositories owned by organizations.

## Decision
### 1. Per-PR log fragments (fixes the conflict loops)
- New entries go in `docs-vault/wiki/log.d/<YYYY-MM-DD>-<branch-slug>.md`: one or more bullet lines,
  same style as today. The file name is unique per branch, so two PRs never touch the same file.
- `log.md` is frozen at the migration with a header: "Entries after <date> are in `log.d/`; `npm run log`
  prints the whole log in order." Optional compaction (`npm run log -- --compact`) folds fragments into
  `log.md` in a docs PR by the coordinator, the only writer of `log.md`.
- The CI check (inside `verify`, so already required; pull_request events only) requires the PR to add at
  least one new file under `log.d/`, and to not modify `log.md` or an existing fragment. Two exceptions:
  label `log-compaction` (compaction PRs), and Dependabot PRs.
- Migration: one PR adds the folder, a README, the script and the check, freezes `log.md`, and updates
  the references (repo `CLAUDE.md`, `docs-vault/wiki/index.md`, `decisions/README.md`). In-flight PRs
  move their log line into a fragment the next time they merge `main`.

### 2. Merge queue on `main` (catches "green alone, broken together")
- Settings: squash; group size 1 (each PR is tested on top of the latest `main`, one at a time; our volume
  doesn't need batching); only merge non-failing; check timeout 60 min. Repository setting
  `allow_auto_merge` on (it is off today).
- Workflows: `ci.yml` and `e2e.yml` gain `merge_group:`. In a merge group, jobs run in full (no path
  filtering: base = `merge_group.base_sha`), and e2e never writes baselines.
- `fresh-eyes/test-hunter` on the merge-group commit: a new workflow `fresh-eyes-gate.yml` on
  `merge_group` reads the PR number from `merge_group.head_ref` (`gh-readonly-queue/main/pr-<N>-<sha>`)
  and looks up the PR's head SHA. If that SHA carries `fresh-eyes/test-hunter` = success, it posts the
  same context on `merge_group.head_sha` ("carried from <sha7>"). Otherwise it posts failure, and the
  queue drops the PR. Permissions: `statuses: write`, `pull-requests: read`. The PR-side procedure is
  unchanged.
- e2e baselines: if another UI PR merged first, the queued run fails on screenshot diffs and the PR is
  removed before `main` breaks. The author merges `main`, regenerates the baselines (the existing
  `workflow_dispatch` `update_snapshots`), and re-queues.
- Enqueue (coordinator only, merge authority unchanged): `gh pr merge <N> --auto`. If checks are pending,
  auto-merge queues it when they pass. If they've passed, it is added now. Dequeue:
  `gh pr merge <N> --disable-auto`. Never `--admin` (the ruleset keeps no bypass actors).
- Rollback: remove the merge-queue rule from the ruleset. The `merge_group` triggers are harmless
  without it.

### 3. One GitHub Projects board as the task queue
- One organization project covering all Sour-Dev-Home repos. Fields: Status (Backlog, Ready,
  In progress, In review, Waiting on Leonardo, Done), Owner (dev, frontend, architect, coordinator,
  portfolio, Leonardo), ADR (text), Tier (FULL, FULL+sec, QUICK, skip), Blocked by (text, `#N`).
  Built-in workflows: auto-add repo issues; item closed or PR merged moves to Done.
- An issue is: each row of an accepted ADR's build plan, bugs, and owner requests. Not an issue: review
  rounds, fix-ups, and the PR itself (it links with "Closes #N").
- Who updates: each session moves its own items (In progress when it branches, In review when it
  sends "ready"). The architect opens the build-plan issues when an ADR is accepted. The coordinator
  grooms Ready and "Waiting on Leonardo".
- Tooling: the `gh` token needs the `project` scope (`gh auth refresh -s project`; today's token lacks
  `read:project`). A small workspace helper (outside the repos) hides project, field and option ids:
  `board status <issue> "In review"`.
- WORKFLOW.md keeps the process and ARCHITECTURE.md keeps decisions. Open task lists move to the board.

## Consequences
- No more log conflicts. The chronological log is one command away instead of one file.
- Every PR runs CI twice (PR and queue). Public-repo Actions minutes are free; merges take a few minutes
  longer.
- Sessions gain two small habits: write a fragment, and move their board item.

## Not now
- Feature flags as a system: not warranted for one operator and one environment. Existing switches stay
  what they are: gate B is configuration (Google variables present), LAN stays a code constant by design
  (ADR-0030 amendment 1). One exception is worth it: an environment kill switch for the Discord sender
  (default off), so ADR-0027 PR 6 can deploy dark until the threshold tuning lands. Trigger for a flag
  system: a second environment or staged rollouts to other users.
- Batching in the merge queue (group size > 1): trigger is a queue that regularly waits more than 30 min.

## Revisit when
- The repo becomes private (merge queue then needs GitHub Enterprise Cloud), or another tool (e.g.
  changesets for releases) replaces the log.

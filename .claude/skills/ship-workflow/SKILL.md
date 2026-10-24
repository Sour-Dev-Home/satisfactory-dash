---
name: ship-workflow
description: Use when shipping a finished branch as a PR, regenerating visual baselines, or cleaning up merged worktrees, in satisfactory-dash or the portfolio. Runs the repo's scripts instead of improvising git/gh sequences.
---

# Ship workflow: use the scripts, don't improvise

The routine steps around a PR are scripted in `scripts/dev/` (satisfactory-dash). They work for both
satisfactory-dash and the portfolio. The repo is detected from the worktree's `origin`. Run them from the
satisfactory-dash checkout, and point them at any worktree.

## Ship a branch
```sh
npm run ship-pr -- <worktree> --title "<title>" --body-file <path>
```
It refuses uncommitted work (an untracked `.claude-impl-*.md` agent report is fine). It refuses a diff that adds an
absolute local path or the portfolio's banned phrase, prints each problem's file:line, and never pushes main or
force-pushes. In satisfactory-dash it turns on squash auto-merge (ADR-0043). In the portfolio it leaves merging to
the owner. Write the PR body to a temp file first. Before shipping, run the fitting reviewer subagents yourself
(CLAUDE.md "Workflow").

## Regenerate visual baselines
```sh
npm run baselines -- <worktree> [--only "<glob>"]... [--run <id>] [--commit "<message>"] [--local]
```
Push the branch first. CI screenshots the pushed commit, and the script refuses to run otherwise. It dispatches
the repo's screenshot workflow, waits, fails loudly if a test failed (fix the test; the run saved nothing), then
applies the artifact and lists what changed.
- In satisfactory-dash the regeneration writes only screenshots that fail the 50-pixel tolerance or are missing
  (#503), so unrelated screens no longer change; `--only` is no longer needed. Still read the changed list
  before committing.
- `--run` reuses a finished or running run instead of dispatching a new one.
- `--local` regenerates on the optional remote box (`DEV_REMOTE_HOST`) in the same pinned image, with no push; if the box is
  unset or fails before the tests it says why and continues with the CI path. See runbooks/dev-remote.md.
- It commits only with `--commit`, and never pushes.

## Clean up
```sh
npm run cleanup-merged -- [<repo-root>] [--dry-run]
```
It removes worktrees under `.claude/worktrees/` whose PR is merged, along with their branches. It skips locked
worktrees (a running agent holds those), uncommitted work and unmerged branches.

## Keep doing by hand
Choosing reviewers, writing the PR body, judging a baseline diff (look at the images), and anything the owner
decides.

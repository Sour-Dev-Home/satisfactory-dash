# ADR-0043: Retire lanes; plain CI/CD with auto-merge

Status: accepted (owner, 2026-10-20). Supersedes ADR-0033 for the merge queue, the fresh-eyes gate and the task board.

## Context
- The owner, 2026-10-20: "can we remove lanes and just do a reasonable CI CD instead. This is getting out of
  hand. Ive had to manually interfere dozens of times at this point."
- Lanes (adopted in #378) put an AI-agent issue queue and a PR gate in front of `main`. In this repository it cost
  more than it returned:
  - The `lanes/gate` status: every PR had to close a `ready` Task issue, come from an `issue-N-*` branch and carry
    the reviewer statuses, so even a Dependabot bump needed a Task issue.
  - Code-owner reviews: owner-only paths (`CLAUDE.md`, `package*.json`, `.github/`, `.claude/`, `.gitignore`)
    could not be tier `skip`, so most infrastructure PRs waited for the owner.
  - Scope fences: a lane could not touch a file its issue did not name, so small follow-ups became new issues.
  - Hand-overs: workflow-file changes and screenshot baselines had to be passed to the owner or a
    different identity by hand.
  - The queue's relaunch rules: stuck, stopped and bounced lanes needed check-ins and restarts.
- ADR-0033 added a merge queue and the `fresh-eyes/test-hunter` status on top of that; the queue's bounces added
  more manual work.

## Decision
The owner's four choices, 2026-10-20:
1. No PR needs the owner's review.
2. PRs auto-merge (squash) once the required checks `verify`, `e2e` and `security` pass, with no merge queue
   (`gh pr merge --squash --auto`).
3. The lanes code is deleted from this repository; git history keeps it.
4. Only this repository. The separate lanes project repository is untouched.

The `main (lanes)` ruleset is deleted. The `main` ruleset has no merge queue, allows squash only, requires 0
approvals and requires the checks `verify`, `e2e` and `security`.

## Consequences
- **Removed:** `scripts/lanes/`, `lanes.config.json`, `lanes.lock.json`, `CODEOWNERS`, the Task issue form, the
  lanes, fresh-eyes, issue-contract and dashboard workflows, the `/lane`, `/night`, `/plan-issues`, `/status` and
  `/health` commands, the lanes dashboard (ADR-0012 of the lanes project), `docs/USING.md`, the fresh-eyes and
  hunter-status scripts, the hunter log, and the `tier:ui` CI step with its script. Free-text issues are allowed
  again. The PR template is a short plain one.
- **Stays:** the CI checks (`verify`, `e2e`, `security`), the log-fragment check, CodeQL, the deploy and image
  workflows, Dependabot, the git hooks, and the reviewer subagents (`test-hunter`, `ui-reviewer`,
  `security-reviewer`, `architecture-advisor`), which the working session runs itself before the PR.
- ADR-0033's per-PR log fragments stay; its merge queue, fresh-eyes gate and task board are gone.
- The delivery-metrics script stays; it no longer reports merge-queue bounces in its markdown.
- The lanes project repository is unaffected.

## Revisit when
PR volume or the number of contributors grows enough to want a merge queue or required reviews.

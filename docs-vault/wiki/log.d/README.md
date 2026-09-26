# Log fragments

`../log.md` is frozen history (ADR-0033). Every PR since adds its own entry here instead, so two PRs
never edit the same lines and log.md stops being a merge-conflict magnet.

## The rule

- **One new file per PR**, named `<YYYY-MM-DD>-<branch-slug>.md` (the date is the day you write it; the
  slug is lowercase letters, digits and hyphens, e.g. `2026-09-26-history-storage.md`).
- The file holds **one or more bullets in log.md's style**: `- 2026-09-26 — what changed and why, in a few
  sentences.` No heading, no front matter.
- **Never edit `log.md` or a fragment that is already on main.** CI (`scripts/log-check.mjs`, in the
  `verify` job) fails a PR that does, and tells you what to do.
- A fragment is written once. If your PR needs a correction, fix it in the same PR before it merges.

## Reading and compacting

- `npm run log` prints log.md, then the fragments in file-name order (so by date, then slug).
- `npm run log -- --compact` folds the fragments onto the end of log.md and deletes them. The coordinator
  does this in its own PR, labelled `log-compaction` (the one PR label that may edit log.md and
  fragments). Dependabot PRs are exempt from the check.

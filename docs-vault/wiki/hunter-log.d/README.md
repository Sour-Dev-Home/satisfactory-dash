# Test-hunter log

One file per PR's test-hunter work (#341), so the FULL/QUICK/skip tiers can be tuned on evidence rather
than on "about half of PRs had real bugs". Like `log.d/`, each PR adds its own file, so PRs never conflict.

**Who writes it:** the session that runs the hunter, in the same PR as the hunter's tests and fixes.
Name it `<YYYY-MM-DD>-<pr>.md` (a second file for the same PR that day: `-<pr>-2.md`), and start from
`npm run hunter-report -- --template`:

```
- pr: 327
- tier: FULL
- area: frontend
- minutes: 10.1
- tokens: 131567
- bugs: 1
- fixed: 1
- tests: 4
- rounds: 2
```

- `tier`: FULL or QUICK, as the PR was tiered. `area`: backend, frontend, shared, game-adapter, agent or ci.
- `minutes` and `tokens` are totals over every round, from each subagent's usage report
  (`duration_ms`, `total_tokens`).
- `bugs` counts only real bugs, not test gaps; `fixed` is how many of those the PR fixed.
- `rounds` is how many hunter runs it took until one found nothing new.
- Counts and PR numbers only: no names, paths or excerpts.

`npm run hunter-report` prints, by tier and area: runs, median tokens and minutes, bugs per run, and the
share of runs with no real bug. It fails on a malformed file and names it. After about 20 runs, review the
tiers: a tier and area with no real bug in 8 or more runs is listed as a downgrade candidate.

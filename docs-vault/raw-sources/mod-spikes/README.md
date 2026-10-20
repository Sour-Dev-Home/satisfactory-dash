# mod-spikes

Evidence bundles from the ADR-0039 gate G2 spikes, one folder per passing run, named `<spike>-<run start, UTC>`.
`wiki/mod-claims.md` cites them in its "Verified on the real server" column.

Source: the G2 harness in `Sour-Dev-Home/satisfactory-dash-mod`, one PR per spike, each pinned to its merge commit:
- S0 (C1): PR #6, https://github.com/Sour-Dev-Home/satisfactory-dash-mod/commit/723ced5cdaf88d13fb470aaaead2ec0b0841c70c
- S1 (C2): PR #7, https://github.com/Sour-Dev-Home/satisfactory-dash-mod/commit/b482b660857dc13e29491541319e5f9e05e12a59
- S1b (C3): PR #8, https://github.com/Sour-Dev-Home/satisfactory-dash-mod/commit/a1975820dd3506f0b37267cf1b69486f9e2eef90
- S2 (C4): PR #9, https://github.com/Sour-Dev-Home/satisfactory-dash-mod/commit/4f833ce9006215260a7789b395083214032bd468

Captured: the runs' own `startedAt`/`endedAt` (UTC, in each `result.json`): S0 2026-10-19T19:51:25.083Z to 19:52:06.309Z;
S1 2026-10-19T19:53:49.174Z to 19:56:07.687Z; S1b 2026-10-19T19:57:44.313Z to 19:59:29.678Z; S2 2026-10-19T21:35:10.585Z to
22:22:54.654Z. The bundles were posted on this repository's issue #459 at 2026-10-19T23:03:51Z to 23:03:55Z and copied
from there.

Method: the harness's `run <spike>` (`run S0`, `run S1`, `run S1b`, `run S2`), which builds and installs the mod, starts
the server, applies the spike's pass condition and writes the bundle. Files are copied as posted, with line endings
normalised to LF (the repository's `.gitattributes`); nothing else is changed.

## Where they ran

On a **separate test install** of the dedicated server on the owner's PC, as the G2 harness spec decided, **not the
owner's live server**: Steam build 25782485, Net CL 513885 (the `versionLines` say `Net CL: 513885` and
`Build: ++FactoryGame+rel-main-anniversary-2026-CL-513885`), SML 3.12.0.

Toolchain: engine 5.6.1-CSS (css-83), the SML project at `8eebc9e`.

## What was removed

One line was removed from each `result.json`'s `versionLines`: the game's own crash-reporter `x-sentry-auth` header. It
is the game's public client key, not ours; the harness's filter is being tightened in the mod repository. It was the
last entry of `versionLines`, so the comma before it remains and the four `result.json` files are **not strict JSON** (a
trailing comma after the last `versionLines` entry). They are kept that way rather than edited, since raw sources are
copied as posted. `echo.json` and `ticks.json` are untouched and parse as JSON.

## Notes per spike

- **S2's verdict depends on a harness fix.** The first S2 run FAILED: the server runs at about 30 ticks per second after
  boot and then about 22 with or without a mod, and the baseline sampled across that drop. The fix (a 3-minute warm-up
  plus a with-mod steadiness check) is in mod PR #9, which quotes the failed bundle's numbers. In this bundle,
  `ticks.json` has a baseline median of 22.342333793640137 and a with-mod median of 22.024961471557617, and `echo.json`
  holds 40 posts, `n` 1 to 40 in order.
- **S1b's TLS cause.** The mod sees only `error=Other` for the wrong hostname (`modLines`: `satis-mod s1b bad
  error=Other`). The engine's log for that run showed `bVerifyPeer = true` and `libcurl error: 60 (SSL peer certificate
  or SSH remote key was not OK)` after the host resolved; those lines are quoted in mod PR #8 and are not in this bundle
  (later harness runs keep them in `http.json`).

## S4, S5 and S3 (2026-10-20)

Source: the same harness, one PR per spike, each pinned to its merge commit:
- S4 (C6): PR #14, https://github.com/Sour-Dev-Home/satisfactory-dash-mod/commit/eaf53f26542c408b54886329f6c0d5b03e56ba5a
- S5 (C7): PR #15, https://github.com/Sour-Dev-Home/satisfactory-dash-mod/commit/0716c7fec5468e436ba350e4729f85ce2f9083e4
- S3 (C5): PR #16, https://github.com/Sour-Dev-Home/satisfactory-dash-mod/commit/9d74983e97bf4576dad8edf5178ca01bcf341288,
  and PR #18 (joined FRM groups, pairs kept in the bundle),
  https://github.com/Sour-Dev-Home/satisfactory-dash-mod/commit/8df1e9d64156144c622d5251c81e634821806d66

S4 and S5 ran from a local checkout before their PRs merged, so their `harnessCommit` is `local` and `runUrl` is null.
S3's `harnessCommit` is PR #18's merge commit, and its `runUrl` is the Actions run.

Captured: the runs' own `startedAt`/`endedAt` (UTC, in each `result.json`): S4 2026-10-20T01:00:53.086Z to 01:03:19.906Z;
S5 2026-10-20T01:23:37.975Z to 01:24:59.709Z; S3 2026-10-20T02:53:16.010Z to 02:58:47.636Z. The bundles were posted on
this repository's issue #465 at 2026-10-20T03:00:00Z to 03:00:03Z and copied from there.

Method: the harness's `run <spike>` (`run S4`, `run S5`, `run S3`). Files are copied as posted, with LF line endings;
nothing is removed this time, and all four files parse as strict JSON.

### Where they ran

The same separate test install as S0–S2 (Net CL 513885, SML 3.12.0), not the owner's live server. S4 and S5 ran from a
local session (S5 needs Docker; owner, 2026-10-20). S3 ran on the self-hosted runner as `satis-runner`, so that the
copied save's autosaves stay out of the owner's saves folder.

### Notes per spike

- **S4 (C6).** The harness wrote a fresh 32-character credential to the mod's SML config. The mod logged only its length
  and SHA-1 prefix (`modLines`: `satis-mod s4 read length=32 sha1=ec425ea7230d`), which match what the harness wrote.
  The full value never appears in the log. This is server-side proof only: no client was connected.
- **S5 (C7).** A throwaway satisfactory-dash stack ran from this repository's `compose.yaml` at `b11c23b`, behind a
  loopback relay. The mod enrolled (201) and its snapshot was accepted (200) (`modLines`: `satis-mod s5 enroll=201
  snapshot=200`). The database showed the code spent, `agent_version = spike-s5`, and `last_seen_at` set. Neither the
  code nor "Bearer" appears in the log.
- **S3 (C5).**
  - The world was a copy of the owner's save (`NotDoingSchool`), uploaded with `UploadSaveGame`.
  - The mod read each power circuit 12 times, and the harness paired each round with FRM 1.5.4's `getPower` read right
    after it (`power.json`, `pairs`).
  - All 24 pairs are within 1% on production and capacity (mod 3633.33 and 4083.33, FRM 3633.33349609375 and
    4083.33349609375 in every pair). Consumption is not judged: it moves between the two reads (the widest pair is mod
    1282.15, FRM 1305.003662109375).
  - FRM groups the world's circuits 0 and 3 together (`group: [0, 3]`), and the mod read the group's figures for both.
  - Ruling 6 was amended by the owner after run #11, which failed only because joined groups weren't judged (mod #18).

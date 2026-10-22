# mod-core-v1

Evidence for the satisfactory-dash core mod v1 (ADR-0039's G3, sub-project 2), one folder per passing run, named
`<run>-<run start, UTC>`.

Source: the harness in `Sour-Dev-Home/satisfactory-dash-mod`, Plan 2B (PRs #32-#42), pinned to the merge commit of
PR #42, the last one:
https://github.com/Sour-Dev-Home/satisfactory-dash-mod/commit/14129ba1e0c21a58d282aa05208d798e355a5d5d

Method: the harness's `core-run <run>` and `test-mod`, dispatched by the owner on the self-hosted runner and approved
by the owner each time. Each run builds and installs the mod, starts the test server, applies the run's pass
condition (`runs/<run>/pass.ts` in the mod repository) and writes the bundle. Only each run's `result.json` is copied
here, as written. The full bundles (captures, recorder data, parity's snapshots) stay as CI artifacts, linked by run
id below. The one exception is `manual-…/gb-excerpt.json`, a trimmed excerpt explained below.

## Where they ran

On the **separate test install** of the dedicated server on the owner's PC, never the owner's live server: Net CL
513885 (`Build: ++FactoryGame+rel-main-anniversary-2026-CL-513885` in `versionLines`), SML 3.12.0, engine 5.6.1-CSS,
FRM 1.5.4. The backend was the throwaway satisfactory-dash stack from the `main` images, at a revision that descends
from the contract pin `81f22ae`. The harness refuses any other.

## The runs

| Run | Run id | Started (UTC) | Verdict | What it proves |
| --- | --- | --- | --- | --- |
| mod-test | [39667469881](https://github.com/Sour-Dev-Home/satisfactory-dash-mod/actions/runs/39667469881) | 2026-10-21T20:06:50Z | pass | All 80 in-game C++ automation tests: 53 succeeded and 27 succeeded with warnings (tests whose expected output includes a Warning log line); 0 failed |
| http-probe | [39668565578](https://github.com/Sour-Dev-Home/satisfactory-dash-mod/actions/runs/39668565578) | 2026-10-21T20:15:10Z | pass | S1-S3: TLS 1.2+ only, an untrusted certificate refused, no redirect followed and the redirect target received nothing, User-Agent kept |
| enrol | [39680091024](https://github.com/Sour-Dev-Home/satisfactory-dash-mod/actions/runs/39680091024) | 2026-10-21T21:36:38Z | pass | Enrolment with a 60-bit code; snapshots match the game's APIs (status, auto-pause in 16 of 16 rounds, power against FRM) |
| revoke | [39681113514](https://github.com/Sour-Dev-Home/satisfactory-dash-mod/actions/runs/39681113514) | 2026-10-21T21:49:21Z | pass | A revoke halts the mod on the first 401, the credential is deleted, and re-enrolment works |
| command | [39682775057](https://github.com/Sour-Dev-Home/satisfactory-dash-mod/actions/runs/39682775057) | 2026-10-21T22:05:02Z | pass | `set_auto_pause` on, off and on, read back from the game; a bad parameter reports `unsupported` and changes nothing; one accepted result per command |
| outage | [39536478691](https://github.com/Sour-Dev-Home/satisfactory-dash-mod/actions/runs/39536478691) | 2026-10-21T03:04:34Z | pass | Backend outage: one failure line and one recovery line logged; 35 of the 36 snapshots taken during the outage were delivered afterwards (29 needed); tick rate unchanged throughout |
| tick-cost | [39600584441](https://github.com/Sour-Dev-Home/satisfactory-dash-mod/actions/runs/39600584441) | 2026-10-21T12:34:30Z | pass | No tick-rate cost; memory within limits (within 100 MB of the baseline, and no more than 25 MB growth over 10 minutes); S12, the mod contacts only the backend |
| parity | [39634443490](https://github.com/Sour-Dev-Home/satisfactory-dash-mod/actions/runs/39634443490) | 2026-10-21T16:25:14Z | pass | 30 minutes beside the Node agent: 356 pairs, every compared status and auto-pause field equal, power within 3% of the Node agent's neighbouring readings |
| manual | [39642650093](https://github.com/Sour-Dev-Home/satisfactory-dash-mod/actions/runs/39642650093) | 2026-10-21T17:22:05Z | pass | The test server stayed up for 45 minutes (90 of 90 samples) for the owner's G-B1 and G-B2 checks; see `gb-excerpt.json` |

Enrol, revoke and command were re-run after the security fixes, and these are those runs. Outage, tick-cost and
parity ran on earlier code. The final review accepted that, because the changed code is on the same request paths
these re-runs exercise.

## The security review

S1-S14: 11 MET, 3 PARTLY, 0 NOT MET (`docs/reviews/2026-10-core-mod-v1-security.md` in the mod repository).

- **Fixed in PR #42:**
  - F1, JSON nested deeper than 32 levels is refused before parsing;
  - F3, plain-http loopback requests use no proxy;
  - F4, all-dots command IDs are refused.
- **Accepted by the owner (2026-10-21):** OpenSSL 1.1.1t (the engine's copy, end of life), no certificate pinning,
  https proxy variables honoured, Retry-After ignored on enrolment, command-ledger eviction.
- **Deferred to sub-project 4:** the credential file's `0600` mode on Linux and its write order, the release dependency
  list, an asynchronous DNS resolver on each platform, and tightening the probe's TLS-error check.

Decisions: `docs/reviews/2026-10-core-mod-v1-security-decisions.md`.

## Notes

- **mod-test has no `result.json`, and its report isn't kept here.** Its file is Unreal's automation report,
  `index.json`, whose `devices` entry names the runner machine. Rather than edit a raw source, the dash repo leaves
  it out (decided when this folder was added): the run link above is the evidence, and its counts are the table's.
- **`gb-excerpt.json`** (beside manual's result) is a trimmed excerpt of FRM 1.5.4 `getBelts` and `getPipes`, read
  read-only from the test server during the manual session. It keeps only ID, ClassName, ConnectedTo0/1 and
  ItemsPerMinute or Speed for the three test belts and three Mk.2 pipes, plus a count of the world's Mk.1 pipes by
  Speed. There are no positions or geometry.
  - **G-B1:** belt links update on dismantle and on rebuild; a rebuilt belt gets a new ID.
  - **G-B2:** pipe Speed is the rated capacity in m³/s: Mk.1 is 5 and Mk.2 is 10, even when empty.

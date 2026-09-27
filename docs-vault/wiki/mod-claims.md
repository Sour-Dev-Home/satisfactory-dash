# Mod claims (ADR-0039, gate G1)

Every statement of the form "the mod can ..." that a design would rely on is a row here. ADR-0039 makes **no claim about
mod APIs as fact**: a claim has a source (a file in `raw-sources/`, from gate G0) and, before it can be used, a spike that
passed on the owner's real dedicated server (gate G2). Only `verified` rows may appear in a build ADR (G3), and there is
no G3 without the owner's explicit go.

## Rules

- **Status** is one of `unverified`, `verified` or `refuted`. Every row starts `unverified`.
- A claim with no source cannot have a spike **designed on it**: first find its source (G0), or the row says
  `[NEEDS VERIFICATION]` and stays a question, not a fact. (A spike that exists to test an unsourced claim is listed, but
  its result is evidence, not a design basis, until it is recorded here.)
- `refuted` rows stay in the table, as evidence.
- A spike's evidence goes in `raw-sources/mod-spikes/<spike>-<date>/` (a log excerpt, the echo capture, tick numbers and the
  exact game and SML versions); then the row's "Verified on the real server" cell is filled.
- If a spike fails, stop and report; the design is reconsidered before the next spike.

## Known facts from G0 (sources: `raw-sources/*-2026-09-27.*`, pinned URLs inside)

- **Engine and versions:** Unreal Engine 5.6.1 with Coffee Stain's custom changes (`ue-version`); SML 3.12.0 on the SML
  commit the docs pin, the same SML version last recorded on the owner's server (2026-09-22, game 1.2.4.0, CL 502094). The
  owner's own server build is not stated by any source [NEEDS VERIFICATION: the engine version line in its startup log].
- **Toolchain:** 30+ GB of disk, Visual Studio 2022 (not 2026) with specific components, a custom engine installed from
  release files after linking Epic and GitHub accounts, a Linux cross-compile toolchain for Linux servers
  (`sml-getting-started`).
- **Licences:** SML is GPL-3.0 and its `LICENSE.txt` is the plain GPL v3 text with no "only" or "or later" statement
  (`sml-license`). **Decision (owner, 2026-09-27, via the coordinator): the mod repository is GPL-3.0-or-later.** The legal
  read of GPL-3.0 software beside an AGPL-3.0-only web app talking over HTTP stays [NEEDS VERIFICATION] until it is
  recorded in `LEGAL.md` (ADR-0039). FRM has no licence at all (`frm-license-status`): none of its code is read or reused.
- **Coffee Stain's terms on mods:** not found (`coffee-stain-mod-terms`); stays open.
- **The mod repository** is `Sour-Dev-Home/satisfactory-dash-mod`, public from the start, GPL-3.0-or-later, created after G0
  with the organisation's PII check from its first commit and an exploration README (owner, 2026-09-27).

## The claims

| ID | Claim ("the mod can ...") | Source (raw-sources file, section) | Spike | Verified on the real server (date, game build, SML version) | Status |
| --- | --- | --- | --- | --- | --- |
| C1 | load on the owner's dedicated server and write a log line | `sml-dedicated-servers`: SML 3.7 added dedicated-server support and a mod must be built for the Windows Server / Linux Server targets ("Upgrading from SML 3.6.x to 3.7.x"); `sml-cpp-modding`: a game-instance Mod Module is "called once while the game is launching" ("Mod Modules"); `sml-dedicated-servers`: a dedicated server's `FactoryGame.log` "could" be under `<install dir>/FactoryGame/Saved/Logs` (FAQ, "Log Files") | S0 | | unverified |
| C2 | send one HTTP POST to a loopback echo server at startup | `ue-http-timer-json`: `FHttpModule::CreateRequest`, `IHttpRequest::SetURL`, `SetVerb`, `SetContentAsString`, `ProcessRequest` (documented for UE 5.6); `FHttpModule::bEnableHttp` and `AllowedDomains` ("If Empty then no filtering is applied"). Nothing in the sources says these work inside a Satisfactory mod on a dedicated server [NEEDS VERIFICATION] | S1 | | unverified |
| C3 | send one HTTPS request with certificate verification on | **no source**: the captured UE HTTP pages do not mention TLS or certificate verification (`ue-http-timer-json`, NOT FOUND) [NEEDS VERIFICATION]. S1b tests it empirically (a wrong hostname must fail); its result is evidence, not a design basis, until recorded here | S1b | | unverified |
| C4 | run a 30 s timer for 30 min without a tick-rate drop | `ue-http-timer-json`: `FTimerManager::SetTimer` and `FTSTicker` ("Thread-safe ticker class. Fires delegates after a delay"). The tick-rate effect is documented nowhere in the sources [NEEDS VERIFICATION]; measured with the tick-rate card before and after | S2 | | unverified |
| C5 | read one power value that matches FRM `getPower` at the same moment | **no source captured**: G0 did not cover the game's power API from C++; the SML docs have a page on it (`modules/ROOT/pages/Development/Satisfactory/PowerNetwork.adoc` at the pinned Documentation commit) that has not been captured or read [NEEDS VERIFICATION: capture it as a G0 addendum first] | S3 | | unverified |
| C6 | store a credential in its config, not visible to game clients | `sml-config`: config files live in `<game install directory>/FactoryGame/Configs`, one `<ModID>.cfg` per mod, JSON. The pages describe a client install and say nothing about a dedicated server or about who can read the folder [NEEDS VERIFICATION] | S4 | | unverified |
| C7 | enrol with a code and push a minimal valid snapshot to a local backend | this repository's own contract, not a mod API: `packages/shared/src/agent.ts` (`SnapshotRequestSchema`, `agentVersion`) and ADR-0031; depends on C2 (and on C3 for anything but loopback) | S5 | | unverified |

## Spikes (from the ADR-0039 exploration cards)

Each runs on the owner's real dedicated server, smallest first, in the separate spike repository; S5 targets a LOCAL backend
only (a dev or `satis_load` database, never production), and nothing talks to production except S1b's read-only health GET.

| Spike | Claim | What | Pass |
| --- | --- | --- | --- |
| G2-prep | none | Owner action: install the toolchain exactly as `sml-getting-started` says | the SML starter project builds |
| S0 | C1 | an empty mod that logs `satis-mod loaded` on server start | the line appears in the dedicated server's log |
| S1 | C2 | at startup, POST a fixed small JSON to `http://127.0.0.1:<port>` (a local echo script) | the echo capture shows the body and the headers |
| S1b | C3 | GET `https://api.satis-manager.com/api/health` with verification on, and log the status | a 200 is logged; a deliberately wrong hostname fails verification (proving the check is on) |
| S2 | C4 | every 30 s, POST a counter to the echo server for 30 min | 60 posts arrive; the tick-rate card shows no drop compared with 30 min without the mod |
| S3 | C5 | read the total power consumption of one circuit through the documented API, and post it | the value matches FRM `getPower` read at the same moment, within rounding |
| S4 | C6 | read a token from the mod's config file | the token is used; the file's location and permissions are recorded; a game client cannot read it (how that is checked is decided from the G0 sources) |
| S5 | C7 | against a local backend: enrol with a code, then POST a snapshot with `status` only, as `agentVersion: "mod/0.0"` | the backend accepts it and the dashboard shows the server online |

## Open questions (not claims)

- Coffee Stain's terms on mods: not found by script; the owner may read the EULA shown at install.
- The legal read of GPL-3.0-or-later software beside the AGPL-3.0-only web app: to be recorded in `LEGAL.md`.
- How often SML breaks mods across game releases (ADR-0039 option C's cost) [NEEDS VERIFICATION].
- Whether the owner's own server build's engine version matches 5.6.1 (its startup log).

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

## Known facts from G0 (sources: `raw-sources/*-2026-09-27.*`, the 2026-10-19 addendum's `raw-sources/*-2026-10-19.md` and the second addendum's `raw-sources/*-2026-10-20.md`, pinned URLs inside)

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
- **Building without the editor UI (G0 addendum, #452; `sml-alpakit-packaging-2026-10-19.md`):** the SML docs describe
  packaging only through the editor's Alpakit windows (E1, E2): a documented command line is **NOT FOUND** in the docs.
  The SML source has one: Alpakit is the Unreal Automation Tool command `PackagePlugin` (E3), the editor builds its
  command line from a format string that adds `-server -serverplatform=<server platforms>` for server targets (E4), and
  SML's own CI packages SML with the exact invocation in E5 (`RunUAT.sh ... PackagePlugin ... -dlcname=SML -merge -build
  -server ... -serverplatform=Win64+Linux ...`, after `Build.sh FactoryEditor Linux Development`). That invocation runs on
  a Linux host and packages SML, not another mod; the Windows-host form for the owner's mod is stated by no source
  [NEEDS VERIFICATION], so the harness's `buildCommand` goes back to the owner as a design question, not a composed command.
- **Server ports (G0 addendum, #452; `dedicated-server-ports-2026-10-19.md`, a community source, the Satisfactory wiki;
  no official Coffee Stain source found):** the standard port, default 7777, carries the HTTPS API (TCP) and game traffic
  and the Lightweight Query API (UDP); the Reliable Messaging port, default 8888, TCP (E1). `-Port=<n>` moves the
  standard port and steps up to the next free one if it is taken; `-ReliablePort=<n>` moves the reliable port and the
  server fails to start if it is taken; `-ExternalReliablePort=<n>` is for external remapping (E1, E2). `Engine.ini`
  `[URL]` `Port=` is the INI form of `-Port` (E3); an INI form of the reliable-port options is NOT FOUND.
- **Saves on a Windows dedicated server (G0 addendum 2, #462):** the official API document names no save or settings
  path (`dedicated-server-api-saves-2026-10-20.md`, NOT FOUND). The community wiki
  (`dedicated-server-save-files-2026-10-20.md`) gives the saves folder as `%LocalAppData%\FactoryGame\Saved\SaveGames\server`
  for a server run as a user, and other folders for NSSM and a Windows Server service, so it **depends on the account**
  running the server (E4); the server settings file `ServerSettings.PORT.sav` sits one level up, `PORT` being the server's
  port (E3), and holds the server name, player password, auto-load session name and certificate (E6). Loading one save
  (official, `dedicated-server-api-saves-2026-10-20.md`): `UploadSaveGame` uploads a file under a `SaveName` and can load
  it at once (E4); `EnumerateSessions` lists the saves by `SaveName` (E2); `LoadGame` loads one by `SaveName` (E3);
  `SetAutoLoadSessionName` picks the session loaded on startup (E1), whose most recent save loads (wiki E2); all need
  Admin. A launch argument or ini setting that loads a save is **NOT FOUND** (wiki E5 lists none), and so is a rule for a
  `.sav` copied into the folder by hand.
- **FRM's port (G0 addendum 2, #462; `frm-config-port-1.5.4-2026-10-20.md`, FRM's docs at tag `1.5.4-515`, commit
  b4a712b6, identical at `1.5.4-510`):** the key `<prefix>.uWS.Port`, "TCP Port for Web Server, Default: 8080" (E3), with
  the prefix `FicsitRemoteMonitoring.Server` on a dedicated server, stored in
  `<Server Install Location>/FactoryGame/Saved/Config/WindowsServer/GameUserSettings.ini` (E2); the page says the new system
  allows "easier configuration in-game" and shows a "Dedicated Server Config Location" image (E1); the legacy `WebServer.cfg` is no longer read (E1). The ini section and line syntax for the key are
  **NOT FOUND**.

## The claims

| ID | Claim ("the mod can ...") | Source (raw-sources file, section) | Spike | Verified on the real server (date, game build, SML version) | Status |
| --- | --- | --- | --- | --- | --- |
| C1 | load on the owner's dedicated server and write a log line | `sml-dedicated-servers`: SML 3.7 added dedicated-server support and a mod must be built for the Windows Server / Linux Server targets ("Upgrading from SML 3.6.x to 3.7.x"); `sml-cpp-modding`: a game-instance Mod Module is "called once while the game is launching" ("Mod Modules"); `sml-dedicated-servers`: a dedicated server's `FactoryGame.log` "could" be under `<install dir>/FactoryGame/Saved/Logs` (FAQ, "Log Files") | S0 | [2026-10-19, test install, CL 513885, SML 3.12.0](../raw-sources/mod-spikes/S0-2026-10-19T19-51-25-083Z/result.json): the server log has `satis-mod loaded` (`modLines`) | verified |
| C2 | send one HTTP POST to a loopback echo server at startup | `ue-http-timer-json`: `FHttpModule::CreateRequest`, `IHttpRequest::SetURL`, `SetVerb`, `SetContentAsString`, `ProcessRequest` (documented for UE 5.6); `FHttpModule::bEnableHttp` and `AllowedDomains` ("If Empty then no filtering is applied"). Nothing in the sources says these work inside a Satisfactory mod on a dedicated server [NEEDS VERIFICATION] | S1 | [2026-10-19, test install, CL 513885, SML 3.12.0](../raw-sources/mod-spikes/S1-2026-10-19T19-53-49-174Z/): `echo.json` captured one POST to `/s1` with the expected JSON body and `content-type: application/json`; the mod logged `s1 done status=200` | verified |
| C3 | send one HTTPS request with certificate verification on | **no source**: the captured UE HTTP pages do not mention TLS or certificate verification (`ue-http-timer-json`, NOT FOUND) [NEEDS VERIFICATION]. S1b tests it empirically (a wrong hostname must fail); its result is evidence, not a design basis, until recorded here | S1b | [2026-10-19, test install, CL 513885, SML 3.12.0](../raw-sources/mod-spikes/S1b-2026-10-19T19-57-44-313Z/result.json): `s1b good status=200`, and the wrong hostname was refused (`s1b bad error=Other`; the engine log showed `bVerifyPeer = true` and libcurl error 60, see the bundle's README) | verified |
| C4 | run a 30 s timer for 20 min without a tick-rate drop, compared with 20 min without the mod (owner, 2026-10-19) | `ue-http-timer-json`: `FTimerManager::SetTimer` and `FTSTicker` ("Thread-safe ticker class. Fires delegates after a delay"). The tick-rate effect is documented nowhere in the sources [NEEDS VERIFICATION]; measured with the tick-rate card before and after | S2 | [2026-10-19, test install, CL 513885, SML 3.12.0](../raw-sources/mod-spikes/S2-2026-10-19T21-35-10-585Z/): tick-rate medians from `ticks.json` 22.34 without the mod and 22.02 with it; `echo.json` holds the 40 posts (`n` 1 to 40, in order). The pass depends on the harness warm-up fix in mod PR #9 (see the bundle's README) | verified |
| C5 | read a power circuit's production and capacity that match FRM `getPower` at the same moment (consumption is not judged) | `sml-power-network-2026-10-19.md` (SML docs `PowerNetwork.adoc` at Documentation d35cc911): the page names the classes `UFGPowerCircuit` (it "gathers data about the current production and consumption of the network"), `UFGPowerConnectionComponent` ("M Circuit ID") and `UFGPowerInfoComponent` ("Actual Consumption", "The consumption used in the last tick of the power grid") (E2-E4), but no function, header or circuit-total accessor (NOT FOUND); whether these names exist in the game's headers is S3's job [NEEDS VERIFICATION] | S3 | [2026-10-20, test install, CL 513885, SML 3.12.0](../raw-sources/mod-spikes/S3-2026-10-20T02-53-16-010Z/): on a copy of the owner's save, `power.json` holds 24 pairs (12 rounds, circuits 0 and 3, which FRM groups together), all within 1% of FRM 1.5.4 on production and capacity; consumption moves between the reads and is not judged. The pass depends on the owner's amended ruling 6 and mod PR #18 (see the bundle's README) | verified |
| C6 | store a credential in its config (server-side; no client connected) | `sml-config`: config files live in `<game install directory>/FactoryGame/Configs`, one `<ModID>.cfg` per mod, JSON. The pages describe a client install and say nothing about a dedicated server or about who can read the folder [NEEDS VERIFICATION] | S4 | [2026-10-20, test install, CL 513885, SML 3.12.0](../raw-sources/mod-spikes/S4-2026-10-20T01-00-53-086Z/result.json): the mod read the 32-character credential the harness wrote and logged only `length=32 sha1=ec425ea7230d`; the value never appears in the log. Server-side only: whether a game client can read it was not tested | verified |
| C7 | enrol with a code and push a minimal valid snapshot to a local backend | this repository's own contract, not a mod API: `packages/shared/src/agent.ts` (`SnapshotRequestSchema`, `agentVersion`) and ADR-0031; depends on C2 (and on C3 for anything but loopback) | S5 | [2026-10-20, test install, CL 513885, SML 3.12.0](../raw-sources/mod-spikes/S5-2026-10-20T01-23-37-975Z/result.json): against a throwaway local stack from `compose.yaml` at `b11c23b`, the mod logged `s5 enroll=201 snapshot=200`; the database showed the code spent, `agent_version = spike-s5` and `last_seen_at` set (see the bundle's README) | verified |
| C8 | read every status field natively (session name, game running, paused, players and limit, tick rate, total game duration, tick health), matching `QueryServerState` at the same moment | header only: `FGServerSubsystem.h` (`UFGServerSubsystem::GetServerGameState`, line 140) and `FGServerStateController.h` (`Handler_HealthCheck`, line 49), as cited in the mod repository's `api-sources.md` at `f6d3ef0`; no file under `raw-sources/` documents them | S6 | [2026-10-20, test install, CL 513885, SML 3.12.0](../raw-sources/mod-spikes/S6-2026-10-20T13-26-42-134Z/): run 39428218556's 30 readings (15 with no game, 15 with the S3 save loaded) each matched `QueryServerState` and `HealthCheck` read right after, except the tick rate of the first reading after the load (24.18 against 28.4). The owner ruled on 2026-10-20 that this one reading isn't judged on tick rate (mod PR #23); `result.json` is the run's FAIL and `rejudge.json` the amended rule's PASS (see the bundle's README) | verified |
| C9 | read and change auto-pause natively, matching `GetServerOptions` | header only: `FGServerStateController.h` (`Handler_GetServerOptions`, line 40) and `FGServerManagementController.h` (`Handler_ApplyServerOptions`, line 60), as cited in the mod repository's `api-sources.md` at `f6d3ef0`; no file under `raw-sources/` documents them | S7 | [2026-10-20, test install, CL 513885, SML 3.12.0](../raw-sources/mod-spikes/S7-2026-10-20T14-24-42-870Z/): in run 39432236818 the mod read `FG.DSAutoPause` (True), set it False, read it, restored True and read again; `GetServerOptions` agreed at all five steps and no change was left pending (`autopause.json`) | verified |
| C10 | read every power field natively (production, consumption, capacity, max consumption, battery figures, fuse state), matching FRM `getPower` (ADR-0058 R0) | header only: `raw-sources/mod-native-readers-s1-headers-2026-10-25.md`, "R0 power"; the mod's `Native/Power/PROVENANCE.md` cites each header line | native-parity | [2026-10-25/26, test install, CL 513885, SML 3.12.0](../raw-sources/mod-native-readers/): runs 40244496806 and 40253178598, 351 and 357 rounds within 3% of FRM's neighbouring reads, every compared field matching; tick-cost-native 40262414493 passed. NOT EXERCISED on the server: a tripped fuse and a merged circuit group (one group in the test world; FRM's merged-group output is in `captured-responses/frm-getPower-2026-09-22-H-battery-charging.json`, and the mod's grouping is unit-tested) | verified |
| C11 | list the players natively (name and online), matching FRM `getPlayer` (ADR-0058 R1) | header only: `raw-sources/mod-native-readers-s1-headers-2026-10-25.md`, "R1 players"; the offline list comes from `AFGGameState::GetAllPlayerInfoData` (`FGGameState.h:515`), cited in the mod's `Native/Players/PROVENANCE.md` | native-parity | [2026-10-25/26, test install, CL 513885, SML 3.12.0](../raw-sources/mod-native-readers/): runs 40244496806 and 40253178598, 351 and 357 rounds with the (hashed name, online) lists equal to FRM's; tick-cost-native 40262414493 passed. NOT EXERCISED: any online player. `GetOfflineCachedPlayerInfosInSession` crashed the dedicated server (run 40241942772) and is not used | verified |
| C12 | read the world's resource nodes natively (resource, purity, kind, position, exploited), matching FRM `getResourceNode` (ADR-0058 R4) | header only: `raw-sources/mod-native-readers-s1-headers-2026-10-25.md`, "R4 resource nodes"; the mod's `Native/ResourceNodes/PROVENANCE.md` cites each header line | native-parity | [2026-10-25/26, test install, CL 513885, SML 3.12.0](../raw-sources/mod-native-readers/): in runs 40244496806 and 40253178598 the posted layer was valid against the contract and equal to FRM's (608 nodes, 31 exploited). The sliced game-thread scan took about 4.5 ms over 35 steps, with the longest step under 0.3 ms; tick-cost-native 40262414493 passed | verified |

## Spikes (from the ADR-0039 exploration cards)

Each runs on the owner's real dedicated server, smallest first, in the separate spike repository; S5 targets a LOCAL backend
only (a dev or `satis_load` database, never production), and nothing talks to production except S1b's read-only health GET.

| Spike | Claim | What | Pass |
| --- | --- | --- | --- |
| G2-prep | none | Owner action: install the toolchain exactly as `sml-getting-started` says | the SML starter project builds |
| S0 | C1 | an empty mod that logs `satis-mod loaded` on server start | the line appears in the dedicated server's log |
| S1 | C2 | at startup, POST a fixed small JSON to `http://127.0.0.1:<port>` (a local echo script) | the echo capture shows the body and the headers |
| S1b | C3 | GET `https://api.satis-manager.com/api/health` with verification on, and log the status | a 200 is logged; a deliberately wrong hostname fails verification (proving the check is on) |
| S2 | C4 | 20 min without the mod, then every 30 s, POST a counter to the echo server for 20 min (owner, 2026-10-19) | 40 posts arrive; the tick-rate card shows no drop compared with the 20 min without the mod |
| S3 | C5 | read the total power consumption of one circuit through the documented API, and post it | the value matches FRM `getPower` read at the same moment, within rounding |
| S4 | C6 | read a token from the mod's config file | the token is used; the file's location and permissions are recorded; a game client cannot read it (how that is checked is decided from the G0 sources) |
| S5 | C7 | against a local backend: enrol with a code, then POST a snapshot with `status` only, as `agentVersion: "mod/0.0"` | the backend accepts it and the dashboard shows the server online |

## Open questions (not claims)

- Coffee Stain's terms on mods: not found by script; the owner may read the EULA shown at install.
- The legal read of GPL-3.0-or-later software beside the AGPL-3.0-only web app: to be recorded in `LEGAL.md`.
- How often SML breaks mods across game releases (ADR-0039 option C's cost) [NEEDS VERIFICATION].
- Whether the owner's own server build's engine version matches 5.6.1 (its startup log). The test install's startup log
  shows `Engine Version: 5.6.1-513885` (the S4 bundle's `versionLines`, `raw-sources/mod-spikes/S4-2026-10-20T01-00-53-086Z/result.json`);
  that covers the test install, not the owner's live server.

## G3 readiness (parked, owner 2026-10-20)

- **The owner un-parked G3 on 2026-10-20:** see [ADR-0042](./decisions/0042-build-the-mod.md). The rest of this section
  stays as history.
- **G0–G2 are complete:** claims C1–C7 are all verified, on the S0, S1, S1b, S2, S3, S4 and S5 bundles under
  `raw-sources/mod-spikes/` (see "The claims" above and that folder's README).
- **G3 is parked until ADR-0039 decision 3's trigger:** a player whose rented game server can't run the agent. The owner
  chose on 2026-10-20 not to propose a build yet; the agent stays the supported path.
- **Before a build ADR**, each of these is settled, or carried into that ADR as a named risk:
  1. the legal reading of GPL-3.0-or-later software beside the AGPL-3.0-only web app, recorded in `LEGAL.md`:
     now in [`LEGAL.md` "The game mod (ADR-0039)"](../../LEGAL.md#the-game-mod-adr-0039) (#471), on the GPL text
     (`raw-sources/sml-license-2026-09-27.txt`) and the FSF's FAQ (`raw-sources/gpl-faq-2026-10-20.md`); its open
     points stay [NEEDS VERIFICATION] there;
  2. Coffee Stain's terms on mods: still not found by script on 2026-10-20
     (`raw-sources/coffee-stain-mod-terms-2026-10-20.md`); ficsit.app's own rules are in
     `raw-sources/ficsit-app-mod-rules-2026-10-20.md`, and both are read in the same `LEGAL.md` section;
  3. how often SML breaks mods across game releases (option C's ongoing cost): now tabulated in
     [`mod-maintenance.md` "SML across game updates"](./mod-maintenance.md#sml-across-game-updates) (#472), on
     `raw-sources/sml-releases-2026-10-20.md` and `raw-sources/satisfactory-patch-history-2026-10-20.md`; whether
     hotfixes with no SML release broke mods stays [NEEDS VERIFICATION] there;
  4. which game hosts allow installing a custom mod, and whether they allow outbound HTTPS from the game process
     (ADR-0039 Context): five hosts' docs are in
     [`mod-maintenance.md` "Rented hosts and custom mods"](./mod-maintenance.md#rented-hosts-and-custom-mods) (#472),
     on `raw-sources/game-hosts-mods-2026-10-20.md`; all five install ficsit.app mods, none states outbound network
     access, so that part stays [NEEDS VERIFICATION].
- **Lessons from the spikes a build must keep:**
  - The server's saves folder is per Windows account, so S3 runs only as `satis-runner` (mod repo `docs/runner.md`, "Only as `satis-runner`").
  - FRM groups switch-joined circuits, and a circuit's power stats are its group's (ruling 6, amended; mod PR #18).
  - A game-host build needs SML's pre-build PowerShell script to be allowed to run (mod PR #17).
  - The mod logs through its own category, because the game filters `LogTemp` to Warning (mod PR #6).

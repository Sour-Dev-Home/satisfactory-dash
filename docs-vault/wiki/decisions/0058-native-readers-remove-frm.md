# ADR-0058: Native game readers in the mod, then remove the FRM dependency and bridge

Status: **accepted** (owner, 2026-10-25; answers and the sprint grouping in "Owner's answers" at the end, which override
Decisions 2 and 6 where they differ). Written to carry out the owner's decision recorded in ADR-0051 section 2 ("lets move
to removing the dependency now. its a big project and scraps some work but it would be worth it ... Ideally we get
parity with the info we already use for the dashboard"). Nothing here is built until the owner approves it in the mod
session; the owner questions are at the end, each with a recommendation.

Evidence is cited to this repository (`file:line`), to `raw-sources/`, or to the mod repository
(`Sour-Dev-Home/satisfactory-dash-mod`, "the mod repo"). The game's own class and property names are cited only where
a source in `raw-sources/` carries them; every other native source below is **[NEEDS VERIFICATION]** and is a *candidate
named from the dashboard's own needs*, to be confirmed against the game headers in the header-survey step (Decision 3,
gate 1) before any code relies on it.

## Context

- The product reads the game two ways. The Node agent and the backend's local poller read it through
  `packages/game-adapter`: the vanilla HTTPS API for status and settings, and FicsitRemoteMonitoring (FRM) over local
  HTTP for everything else (`packages/game-adapter/src/satisfactoryServerAdapter.ts:175-311`). The mod posts the same
  `/agent/v1` contract from inside the game (`packages/shared/src/agent.ts:117-153`; ADR-0039 Decision 2).
- The mod already reads three things natively and has passed the gates for them: status and the auto-pause setting
  (auto-pause equal in 16 of 16 rounds) and power (within 1% on production and capacity in spike S3, within 3% of the
  Node agent over 356 pairs in the parity run), with no tick-rate cost and memory inside its limits
  (`raw-sources/mod-core-v1/README.md:29,33,34`; `wiki/mod-claims.md` C5, C8).
- Everything else the mod posts comes from FRM's HTTP API through a bridge (mod PRs #45 spec, #48 client, #49
  players and factory, #51 `mapLive`, #52 rails and resource nodes; all merged on the mod's main). Plan 3C, the bridge's
  conveyors, is planned and held. The bridge is a client of FRM's local API only; it contains none of FRM's code.
- FRM states no licence (`raw-sources/frm-license-status-2026-09-27.md`; re-checked 2026-10-25 in ADR-0051 section 2).
  The owner will not ask anyone, will not link or compile against FRM, and wants nobody to read its source: a clean room.
  FRM's HTTP API remains fine as an interim client target, and as a black-box oracle for parity.
- The owner accepted that the bridge work is scrapped as it is replaced.

## Decision

### 1. Parity means the data the dashboard uses today, and nothing more

**The scope line.** Parity = every field that reaches the `/agent/v1` contract today (`packages/shared/src/agent.ts`,
`map.ts`, `factory.ts`, `power.ts`, `players.ts`, `status.ts`) from an FRM endpoint. Endpoints the adapter does not call,
and fields the adapter strips (`rawSchemas.ts:171-178` strips everything but `Name`/`Online` from players, ADR-0029), are
not in scope and are never read natively "just because FRM has them". The contract is not changed by this ADR: the
dashboard cannot tell which producer sent a snapshot.

**The inventory.** "Today" is the code on `main` at ADR-0058's date. Difficulty: **Low** = a few properties on one
game list; **Medium** = per-actor iteration with derived values; **High** = a graph, geometry, volume or unknown
semantics. Proof: what native evidence exists today.

| # | Dashboard feature | Contract fields (and where) | FRM endpoint today | FRM fields mapped (`rawSchemas.ts`) | Native source in the game | Difficulty | Proof today |
|---|---|---|---|---|---|---|---|
| 1 | Status card, paused banner | `StatusSchema`: tick health, running, paused, session name, players and limit, tick rate, total duration (`status.ts:6-22`) | none: vanilla `QueryServerState` / `HealthCheck` | n/a | `UFGServerSubsystem::GetServerGameState`, `Handler_HealthCheck` (`FGServerSubsystem.h:140`, `FGServerStateController.h:49`, as cited by `mod-claims.md` C8) | Low | **Proven** (S6: 30 of 30 readings; one tick-rate reading excused by the owner) |
| 2 | Auto-pause toggle (read, `set_auto_pause`) | `settings.autoPause`, `settings.pending` (`agent.ts:123-135`) | none: vanilla `GetServerOptions` / `ApplyServerOptions` | n/a | the game's server-options path (mod repo `api-sources.md`) | Low | **Proven** (16 of 16 rounds; command run) |
| 3 | Power page, outage alerts, power history | per circuit: group id, production, consumption, capacity, max consumption, battery %, battery MWh, battery differential, fuse (`agent.ts:87-93`, `power.ts:31-41`) | `getPower` | `CircuitGroupID`, `PowerProduction`, `PowerConsumed`, `PowerCapacity`, `PowerMaxConsumed`, `BatteryPercent`, `BatteryCapacity`, `BatteryDifferential`, `FuseTriggered` (`rawSchemas.ts:126-145`) | `UFGPowerCircuit` ("gathers data about the current production and consumption of the network"), `UFGPowerConnectionComponent`, `UFGPowerInfoComponent` (`sml-power-network-2026-10-19.md` E2-E4); circuit-total and battery accessors **[NEEDS VERIFICATION]** | Low | **Partly proven**: production and capacity within 1%, power within 3% (S3, parity). Consumption was not judged in S3; max consumption, battery fields, fuse and circuit-group merging (FRM groups circuits 0 and 3) have no native run |
| 4 | Factory table, machine states, backed-up and starved flags, planner, bottleneck finder | per building: id, name, className, recipe, isProducing, isPaused, circuitGroupId, location (x, y, z m, rotation), clockSpeedPercent; `production[]` and `ingredients[]` each name, className, current/max per minute, percent; derived `isBackedUp`, `inputsFull` (`agent.ts:96-105`, `factory.ts:5-108`) | `getFactory` (30 s) | `ID`, `Name`, `ClassName`, `Recipe`, `IsConfigured`, `IsProducing`, `IsPaused`, `ManuSpeed`, `location`, `PowerInfo.CircuitGroupID`; `production[]`: `Name`, `ClassName`, `CurrentProd`, `MaxProd`, `ProdPercent`; `ingredients[]`: `CurrentConsumed`, `MaxConsumed`, `ConsPercent`; `Output/InputInventory` slots: `ClassName`, `Amount`, `MaxAmount` (`rawSchemas.ts:64-124`; `factoryMapper.ts:21-45`) | the factory-building actors (candidates: `AFGBuildableFactory` / `AFGBuildableManufacturer`, current recipe, clock speed, standby, power info) **[NEEDS VERIFICATION]**; rates: the game's production-indicator or recipe-times-clock arithmetic **[NEEDS VERIFICATION: what window FRM's "averaged" current rate uses]** | **High** (largest reader: up to 20,000 buildings, `agent.ts:81`; rates semantics) | none |
| 5 | Who is connected | `players[]`: name, online (`players.ts:9-11`; ADR-0029 data minimisation stays) | `getPlayer` | `Name`, `Online` only (`rawSchemas.ts:175-178`) | the connected-players list in the game state (candidate: player states / the server's player count source) **[NEEDS VERIFICATION]**; the count is already native (row 1) | Low | count proven; names none |
| 6 | Map: live trains and stations | `mapLive.trains` id, name, x, y, status; `mapLive.stations` id, name, x, y (`map.ts:319-338`) | `getTrains`, `getTrainStation` (30 s) | train `ID`, `Name`, `Status`, `location`; station `ID`, `Name`, `location` (`rawSchemas.ts:249-254,293-296`) | the railroad subsystem's trains and station identifiers (candidates `AFGRailroadSubsystem`, `AFGTrain`, `AFGTrainStationIdentifier`) **[NEEDS VERIFICATION]** | Medium (the `Status` string is FRM's own wording, passed through; native must map the game's enum to the same strings) | none |
| 7 | Planner transport edges: train routes | `trainRoutes` layer: stations with platforms (id, load/unload, cargo classes), trains with timetable stops and cargo classes (`map.ts:182-204`) | `getTrainStation`, `getTrains` (10 min) | `CargoInventory[].ID/LoadingMode/Inventory.ClassName`; `TimeTable[].StationName`; `Vehicles[].Inventory.ClassName` (`rawSchemas.ts:262-286`) | the same subsystem plus timetable and freight-car inventory **[NEEDS VERIFICATION]** | Medium | none (the mod bridge does not send this layer yet; only the Node agent and local poller do, `satisfactoryServerAdapter.ts:310-311`) |
| 8 | Map: resource nodes, planner extractors | `resourceNodes` layer: type, purity, nodeType, x, y, exploited, className (`map.ts:84-93`) | `getResourceNode` (10 min) | `Name`, `ClassName`, `Purity`, `NodeType`, `Exploited`, `location` (`rawSchemas.ts:232-241`) | the resource-node actors incl. fracking satellites and geysers (candidate `AFGResourceNode`, with its purity enum and extractor state) **[NEEDS VERIFICATION]** | Low | none |
| 9 | Map: rails | `rails` layer: id, polyline of whole-metre points (`map.ts:68-72`) | `getTrainRails` (10 min) | `ID`, `SplineData[].x/y` (`rawSchemas.ts:200-203`) | the track segments' spline points (candidate the railroad subsystem's track list) **[NEEDS VERIFICATION]** | Medium (thousands of splines, sampling, volume) | none |
| 10 | Planner and bottleneck finder: belts, lifts, pipes graph | `conveyors` layer: id, kind, from, fromKind, to, toKind, capacityPerMinute, tier, at (`map.ts:144-164`) | `getBelts`, `getLifts`, `getPipes` (10 min) | `ID`, `Name`, `location0`, `ConnectedTo0/1`, `ItemsPerMinute` or `Speed` (`rawSchemas.ts:215-223`); end kinds typed by the adapter from the class of the end id (`conveyorsMapper.ts:45`) | the conveyor and pipeline actors and their two connection components (candidates `AFGBuildableConveyorBase`, `AFGBuildablePipeline`, `UFGFactoryConnectionComponent`, `UFGPipeConnectionComponent`) **[NEEDS VERIFICATION]**; tier speed from the conveyor's own speed value (60/120/270/480 per minute in the captures) | **High** (about 2,400 edges on the owner's tier-6 save, `map.ts:104-105`; connection graph; end ids must equal factory ids; open ends; G-B1 rebuilt belts get new ids, `mod-core-v1/README.md:65`) | none; FRM gates G-B1 and G-B2 already settled what FRM does (`mod-core-v1/README.md:65-66`) |

**Two cross-cutting facts that decide difficulty.**
- *Ids.* FRM's building and conveyor ids look like UE object names (`Build_AssemblerMk1_C_2147069774`, captured
  `frm-getFactory-2026-09-22-01-running-trimmed.json`; belt ends reference the same form, `frm-getBelts-2026-10-21-*`).
  Rows 4, 6, 7 and 10 must emit byte-equal ids so the graph joins, the dashboard's per-machine history carries over and
  a host that switches producer sees no break. Whether the native object name is that id is **[NEEDS VERIFICATION]**
  and is tested first by the parity run (id sets must be equal). ADR-0055 anchors player designations to class and
  position, not ids, so a mismatch hurts less there than for the graph.
- *Derived values stay out of the mod.* `state`, `isBackedUp` thresholds and the like are rules the backend applies
  (`factoryMapper.ts:4-5`); the mod sends the raw facts the contract carries (slot fullness for `isBackedUp` and
  `inputsFull`, which the shared mapper computes from inventory slots today, `factoryMapper.ts:21-45`).

**Not in parity scope (decided here).** `getSessionInfo` (used only by the connection test, `connectionTest.ts:47`),
`getPowerUsage` (the adapter method exists, `satisfactoryServerAdapter.ts:228`, and nothing outside tests calls it), and
every endpoint ADR-0055 lists as "not read" (`getDrone`, `getExtractor`, `getRecipes`, `getCloudInv`). The coordinator's
note listed `getStorageInv`: the adapter does not call it either; it is a planned layer (Decision 7), not parity.

### 2. Reader order: cheapest and most-used first, one reader per mod PR group

Each reader is its own unit with its own gate (Decision 3). A reader that fails its gate stays on the bridge; the others
proceed. Order:

| Step | Reader (inventory rows) | Why here |
|---|---|---|
| R0 | Finish power: max consumption, battery fields, fuse, circuit-group merge (3) | Already native and most of it proven; closes the one reader that is half done, so the 5 s path has no FRM left |
| R1 | Players (5) | Smallest unit, a good first run of the whole process (header survey, provenance, parity, similarity) with little risk |
| R2 | Factory machines (4), in two PRs: R2a identity, recipe, state flags, location, clock, circuit group, inventory fullness; R2b production and ingredient rates | The dashboard's core and the biggest cost; R2a is exact-match data, R2b carries the unknown rate semantics, so it is isolated |
| R3 | Live trains and stations (6) with the train-routes layer (7) | One subsystem, one header survey |
| R4 | Resource nodes (8) | Static, small, exact-match, cheap win for the 10-minute tier |
| R5 | Rails (9) | Geometry and volume, but no graph semantics |
| R6 | Conveyors (10) | Last of parity: biggest volume, a join with R2's ids, and Plan 3C is **cancelled** (it would have built an FRM reader only to scrap it) |
| R7 | Final removal release (Decision 4) | Only after R0-R6 pass |

Planned layers that FRM would only partly serve (storage contents, drones, trucks; ADR-0055 PRs 11-12) are **not**
parity work and are not built through FRM at all; see Decision 7.

### 3. The evidence gate every reader passes before its switch

All six hold, and the evidence is committed before the switch PR merges (the ADR-0039 pattern, G0-G2, applied per
reader). Evidence lives where mod-core-v1's lives: result files under `raw-sources/mod-native-readers/<reader>-<UTC
start>/`, full bundles as CI artifacts, and a new row per claim in `wiki/mod-claims.md`.

1. **Header survey, then code.** Before code, the mod session writes a names-only note in the style of
   `raw-sources/factorygame-drone-truck-classes-2026-10-25.md`: the classes and properties from the game's own headers
   shipped with the SML starter project (header file and line per declaration, member names and short comments only).
   A property not in a header or SML doc page is **[NEEDS VERIFICATION]** and cannot be designed on.
2. **Parity run against FRM as a black box.** On the separate test install only (the same install and rules as
   `mod-core-v1/README.md:17-21`; never the owner's live server), the harness runs the native reader and FRM's endpoint
   in the same minute against the same save, paired within a stated offset, for at least 30 minutes (the power parity
   precedent: 356 pairs). Proposed tolerances (the owner may amend them, as he did for tick rate on 2026-10-20):

   | Data | Pass condition |
   |---|---|
   | ids, names, class names, recipe names, booleans, enum strings, ordering-independent id sets | exact, on an idle save (the harness drives no construction) |
   | positions | within 1 m; moving trains by status equality and a distance no more than speed x pair offset + 5 m |
   | power (circuits) | within 3% (the existing parity bar) |
   | machine rates `maxPerMinute` (recipe x clock, deterministic) | within 0.1% |
   | machine rates `currentPerMinute`, `percent` | within 3% on the per-item factory total; per building within 5% for at least 95% of buildings **[NEEDS VERIFICATION: the averaging window]** |
   | graph layers (rails, conveyors, train routes, resource nodes) | the canonical layer (the contract's sorted, deduplicated form that the backend hashes) is equal, or every difference is listed and ruled on |

   FRM is not the truth. Where native and FRM differ, the mod session checks the game, and a difference where FRM is
   wrong (for instance the `Inpure` typo, `map.ts:86`) is recorded in a "known FRM defects" list and
   ruled on by the owner, not silently matched.
3. **Tick cost within the existing limits.** The mod repo's `tick-cost` run with the reader enabled at its production
   cadence (5 s, 30 s, or 10 min per row), on the largest save we have (the copy of the owner's tier-6 save used in S3;
   its machine count is **[NEEDS VERIFICATION]**, to be recorded in the result; ADR-0055's 385-machine "Versatile
   Framework site" is a part of it, `0055-planner-logical-factories.md:36`). Pass = the existing bar: no tick-rate cost
   and memory within 100 MB of the baseline with no more than 25 MB growth over 10 minutes
   (`mod-core-v1/README.md:33`). Readers over thousands of actors (R2, R5, R6) read in slices across ticks; the result
   also records the worst single-tick time the reader added, and the owner fixes a ceiling for it after the first
   measurement (no number is invented here).
4. **Memory and payload.** The reader's peak memory is in the same run; its payload stays inside the contract's caps
   (`AGENT_INPUT_MAX_*`, `agent.ts:80-84`; the 2 MB layer cap).
5. **Contract and fixtures.** The output validates against the shared zod schemas in the harness's snapshot-fixture
   test and reproduces the existing `*.expected.json` goldens (mod PRs #49, #51, #52), which are our contract output and
   outlive the bridge.
6. **Clean room.** The reader's provenance record exists and its similarity score is below the threshold
   (Decision 6).

### 4. Cutover: per-field switch inside the mod, then one removal release

- **The switch is in the mod, the contract does not move.** The mod holds a source per reader, `bridge` or `native`.
  The default flips to `native` in a small PR per reader once its gate evidence is committed. The producer, the endpoint,
  the `mod/x.y` agent version and the zod contract are unchanged, so the backend and the dashboard need no change and
  never notice. There is no dual-write: one source per field at a time.
- **A hidden override for fallback.** While the bridge still exists, a config key per reader lets a host go back to
  `bridge` without waiting for a release (mods update deliberately, ADR-0057 Decision 7, so a bad native reader could
  otherwise stay on a server until the next restart). It needs FRM installed, and it is deleted with the bridge. It is
  documented as a stopgap, not a setting.
- **Releases.** Native readers ship in ordinary mod releases as they pass. A mod release that still contains any bridge
  reader declares FRM as a **required** dependency, as the owner allowed (`^1.5.4` for belt data); a release with every
  reader native declares none.
- **The removal release (R7).** One mod release deletes, together: the bridge code, the `frmPort` and `frmToken` config,
  the per-reader override, the FRM dependency declaration and the setup step "turn on `uWS.Autostart`"
  (`frm-api.md:106-113` via ADR-0051 section 2). Its preconditions: R0-R6 each passed Decision 3; one 24-hour soak with
  every reader on, including the tick-cost run; the full-source similarity check passes; the release notes tell hosts that
  FRM may be removed from the mod's host.
- **The compatibility window.** The backend serves the current mod release and the previous one in full (ADR-0057
  Decision 7). The cutover never changes `/agent/v1`, so a bridge-era release (N-1) and a native-only release (N) are
  both fully supported with no backend work, and removal needs no window beyond the normal one. Anything *additive*
  (the layers in Decision 7) is gated in the dashboard as "needs mod X or newer" and degrades, it never breaks.
- **FRM stays in the test install.** Parity needs an oracle, so FRM remains on the harness's test install as a tool, never
  as a product dependency. The harness's FRM golden script becomes the parity comparator.

### 5. What is scrapped, what stays, and the Node agent

**Scrapped, in the mod repo (by file name; the mod session confirms the final list):**
- The FRM HTTP client and its queue: `Frm.cpp`, `FrmQueue.cpp` (PR #48); `FrmBridge.cpp`.
- The per-endpoint readers and record adapters: `FrmPlayers`, `FrmFactory` (#49), `FrmMapLive`, `FrmMap`, `FrmRecords`
  (#51), `FrmRails`, `FrmResourceNodes`, `FrmWorld` (#52), their tests, and the FRM-shaped *input* fixtures
  (`frm-getFactory-*.json` and the like).
- The FRM-parsing JSON tokenizer (`JsonTokens`) if no native path needs it.
- Config keys `frmPort`, `frmToken`; the harness's FRM-specific fixtures after R7.
- Plan 3C is dropped before it is built.

**Kept:** the driver, snapshot assembly, pusher, world sender, request and response types, the task worker, the mod-test
harness and recorder, and the `*.expected.json` goldens (our output, used as the native reader's acceptance test).

**The Node agent keeps FRM (decided).** ADR-0057 Decision 1 keeps the agent for hosts where the player controls a process
(the owner's FRM-as-API-client allowance covers it), and the owner stopped the Linux-specific agent only because the mod
is to cover Linux (ADR-0057 Decision 8, step 3). So nothing in `packages/game-adapter` or `agent/` is removed by this ADR:
its FRM adapter paths exist for as long as the agent and the local poller exist, and the agent's users keep installing
FRM themselves, as today. What changes is that the agent is **frozen on FRM for today's data**: no new FRM endpoint is
added to the adapter (Decision 7). The agent is retired by its own ADR if the mod ever serves every host it serves;
that is not proposed here.

### 6. The clean-room process

**Rules for every session and subagent working on a native reader (copied into each brief and the mod repo's contributor
note):**
1. **Never open FRM's repository files.** Not on GitHub, not in a clone, not through code search, not in a cache, not
   in a release archive, and not FRM's installed plugin files or packaged assets on any machine. This includes its
   `Source`, `Content`, `JSON`, `Patches`, `www` and `docs` folders and its issues' code snippets.
2. **Allowed sources only:** the game's own headers shipped with the SML starter project; SML's documentation; exports of
   the *game's* assets made with FModel or similar (never FRM's); our own captures, including FRM's HTTP *output* from a
   running server, used as a black box; FRM's published API documentation pages at `docs.ficsit.app`, for endpoint and
   field names only (as ADR-0055 already does); the Unreal Engine reference.
3. **Our names come from the game or from our contract,** never from FRM's response field names. Internal variables,
   types and file names follow the game's property names and the `/agent/v1` schemas. Where FRM's output is the only
   spelling of a value (an enum string passed through, such as a train `Status`), the mapping table is written from
   observed output, not from FRM's code.
4. **If someone sees FRM source by accident** (a search hit, a pasted snippet): stop, tell the owner in the mod session,
   record it in the provenance file, and the reader it touched is rewritten by a different session working from headers
   only. The exposed session does not touch that reader again.
5. **Provenance record per reader,** a file in the mod repo beside the reader: the header files and lines used (the
   survey note's name), the SML pages, the captures used as an oracle, the author session or subagent, the date, and the
   line "FRM source was not opened". The reader's PR template carries the same checkbox, and CI fails a reader directory
   without its provenance file.

**The similarity check.** It is the owner's requirement ("a similarity check before release"). Design:
- **Tool: PMD CPD** (Copy/Paste Detector), a token-based clone detector. It supports C++, and for C++ it has
  `--ignore-identifiers`, `--ignore-literals` and `--ignore-sequences`, which find code that differs only in naming; it
  can compare several directories in one run; and its `csv` report holds only sizes, token counts and start lines with
  file names, **no code fragment** (PMD CPD docs, `cpd.md` and `cpd_report_formats.md`, checked 2026-10-25 through
  context7; the XML and text formats do include fragments and are never used). Pin the PMD version.
- **Run:** a mod-repo workflow (the owner approves the workflow, like any CI) on an ephemeral GitHub-hosted runner, never
  the owner's self-hosted runner, so FRM's code is never on a machine a session can browse. It shallow-clones FRM at a
  pinned commit into the runner's temp directory, runs CPD over the mod's native-reader sources plus the clone, once
  exactly and once with `--ignore-identifiers --ignore-literals`, writes `csv`, and keeps only rows that pair one file
  from the mod with one from the clone. A small script prints, per reader, the number of cross-pairs, the largest duplicated token run and
  the share of the reader's tokens that sit in any cross-pair, and the mod-side file and line range of each hit, never an
  FRM path, line or token. No artifact upload, no step output beyond that summary, clone deleted at the end.
- **Threshold (proposed):** no cross-pair of 50 tokens or more in the exact pass, and no cross-pair of 100 tokens or more in
  the normalised pass. A hit is rewritten (from the headers, by a session that has not seen the hit's other side, which
  holds trivially because no session sees it) and re-run.
- **Limits, stated plainly.** Token matching catches copying and light renaming; it does not catch a rewrite of the same
  structure from reading FRM's code. The real control is rules 1-5 above, and the check is a backstop for accidents. It is
  not a legal opinion. **[NEEDS VERIFICATION]** the exact CPD C++ options and csv layout against the pinned version in the
  first PR that adds the workflow.
- **The irony, and why it is acceptable.** The check must fetch FRM's code. The owner's rule is that no *person or
  agent* reads or uses it as a reference; a pinned clone processed by a tool in a throwaway job, from which only
  our own file names and counts come out, informs no design and gives no session a line to copy. It is the same act as a
  plagiarism detector comparing a paper with its sources. It is not "linking, compiling against, bundling or
  redistributing", and nothing is stored. The residual risk is a reader of the CI log: the script's output filter is the
  guard, and the workflow is reviewed for it. **Safer alternative if the owner is uneasy:** compare *fingerprints* only.
  A job (run by the owner, or in a private ephemeral repository) computes k-gram winnowing hashes of FRM's tokenised
  source and our code's, and shares only which of our hashes collide; this still needs the clone once, in the same
  place, so it adds a hashing step without removing the fetch. The only fully fetch-free option is to skip the check,
  which the owner has ruled out. Recommendation: the CPD job above.
- **When it runs:** on every PR that touches a native reader (score in the PR), and as a hard gate on the release workflow
  before any mod release that contains native readers, as the owner decided in ADR-0051 section 2. Re-pin FRM's commit
  at each release.

### 7. Ownership, and what changes in other plans

- **Owner of the work:** the mod session builds every native reader, the provenance files, the switch, the removal
  release and the similarity workflow, in the mod repo. The dash repo's developer session commits this ADR, the
  evidence under `raw-sources/mod-native-readers/`, the `mod-claims.md` rows and the compatibility notes. The owner
  approves each reader's switch and the removal release in the mod session. No dash backend or frontend work is needed
  for parity (the contract does not move).
- **Plan 3C is cancelled** (Decision 2, R6).
- **ADR-0055 PRs 11 and 12 (storage contents, drone routes, truck routes):** build their contract schemas as planned (the
  contract is producer-agnostic, `0055-planner-logical-factories.md:109-110`), but **do not add FRM adapter paths** for
  them. Their producer is the mod, reading natively, which is how the owner's "pull from game code" already reads
  (`0055-planner-logical-factories.md:89-96`). The header facts for drones and trucks are already captured
  (`raw-sources/factorygame-drone-truck-classes-2026-10-25.md` E1-E5: `AFGBuildableDroneStation`, `AFGDroneStationInfo::mPairedStation`,
  `AFGBuildableDockingStation`, `AFGWheeledVehicleIdentifier::mVehicleRoute`, `AFGVehiclePathSegment`). These readers
  have no complete FRM oracle (FRM 1.5.4 does not expose the truck station-to-path link, E4); their gate-2 evidence is a
  test save the owner builds with one drone pair and one truck route, plus FRM's trimmed captures where they exist. The
  cost is that Node-agent hosts do not get those three layers; the dashboard already degrades
  (`logistics: "partial"`, ADR-0055).
- **The first public mod release** (the ADR-0051 section 3 milestones) is not delayed by R5-R6. Recommended content: R0-R4,
  with the dashboard's existing graceful degradation for missing world layers; if the owner wants a beta before R0-R4 pass,
  that release declares FRM required, per his decision 3.

## Consequences

- The mod ends up with no dependency on another mod, no FRM setup step (`uWS.Autostart`) and no web server on every
  host. That is the zero-touch goal of ADR-0057 Decision 6.
- Several thousand lines of bridge are thrown away (accepted by the owner), but its goldens, harness and structure carry over.
- Native readers run on the game thread and must be sliced; tick cost, not correctness, is the likely cause of a failed
  gate, and the existing harness measures it.
- The dashboard changes in no way, and so cannot regress while a reader is switched.
- The Node agent and the local poller are untouched and stay on FRM; there are two producers for the same data until the
  agent is retired, which is the price of ADR-0057 Decision 1.

## Risks

| Risk | Handling |
|---|---|
| An accidental copy of FRM's code | Rules 1-5, provenance per reader, CPD check on every PR and as a release gate; incident protocol |
| The rate semantics ("averaged current rate") cannot be matched | R2b is isolated; fall back to the deterministic `maxPerMinute` plus an instantaneous flag, and ask the owner to rule on the tolerance; the planner needs demand-side rates (`0055-planner-logical-factories.md:50-53`), so this reader matters most |
| Native ids differ from FRM's | The id-set equality test is the first parity check; if they differ, the owner rules on a one-time id change (it affects history and designations keyed by id, not those anchored by class and position) |
| A game update changes a class or property | Parity and tick-cost rerun on each game build before a release; the header survey names the build (CL) |
| Slow reads cost tick rate on big saves | Sliced reads, the tick-cost gate on the largest save, a worst-tick ceiling the owner sets |
| A native reader is wrong on a host we cannot test | Per-reader override until R7; deliberate updates mean a fix reaches hosts only when they update (ADR-0057 Decision 7), so gates are stricter than for a server we control |
| FRM changes its output and the oracle drifts | Pin the FRM version on the test install (1.5.4 in the runs, `mod-core-v1/README.md:19`) |
| The similarity tool is mistaken for clearance | Stated above: a backstop, not a legal opinion; Coffee Stain's terms stay a separate blocker (ADR-0051 section 2) |

## Revisit when

- A reader fails its tick-cost gate twice: reconsider slicing design or cadence for it (not the gate).
- The owner chooses to retire the Node agent: then `packages/game-adapter`'s FRM paths go too (a separate ADR).
- FRM's maintainer publishes a licence: the clean-room rules could relax, but the plan still stands for the dependency removal.
- Parity of a reader is unreachable (the data is not exposed natively): record the gap in `wiki/data-gap-analysis.md` and
  ask the owner whether to drop that field.

## Owner questions

1. **Scope: stop at the parity inventory?** Recommend yes: rows 1-10 only; planned layers (storage,
   drones, trucks) are mod-native only, never through FRM (Decision 7).
2. **Node agent stays on FRM, frozen, until it is retired by a later ADR?** Recommend yes (Decision 5): it follows the
   owner's allowance for FRM as an API client and keeps ADR-0057 Decision 1 intact.
3. **Public mod release before parity: wait for R0-R4, or ship earlier with FRM required?** Recommend wait for R0-R4 so
   that no public release ever needs FRM; the factory reader is the long pole, so say if a beta cannot wait.
4. **Similarity check: the CPD job on an ephemeral hosted runner (fetches FRM's code once per run, shows only our files and
   counts)?** Recommend yes. The safer fingerprint variant still fetches, so it adds work without removing the fetch.
5. **Tolerances in Decision 3 (3% on rates, 1 m positions, exact ids and graphs) and the 50/100-token thresholds?**
   Recommend approve as the starting bar; amend per reader after the first run, as with tick rate on 2026-10-20.
6. **Test save for drones and trucks:** will the owner build a small save with one drone pair and one truck route on the
   test install? Needed only for the planned layers, not for parity.

## Owner's answers (2026-10-25)
Verbatim: "Yes, yes, yes wait, no on check job, tolerances fine, we have a save already with drones and trucks mod
claude knows about it, yes on banners. Can we combine more endpoints under one sprint/test run. the overhead on each
subagent/task is large for the mod".

1. **Scope:** yes. Parity rows 1-10 only.
2. **Node agent:** yes. It stays on FRM, frozen, until a later ADR retires it.
3. **Public mod release:** wait for R0-R4, so no public release ever needs FRM.
4. **Similarity check: no.** The CPD job is not built and FRM's code is never fetched, by a tool or by anyone. The control
   is the clean-room process of Decision 6, rules 1-5 (never open FRM's files; allowed sources only; our own names; the
   incident protocol; a provenance file per reader). This replaces the "similarity check before release" in ADR-0051
   section 2 and the CPD design in Decision 6. Build task 3 is dropped.
5. **Tolerances:** approved as written (Decision 3) and amended per reader after the first run if needed. The token
   thresholds lapse with the check.
6. **Drone and truck save:** not needed. The save the mod session already uses (the one with drones and trucks, from
   #651) serves the planned layers.

**Sprints instead of one reader per task (owner: "combine more endpoints under one sprint/test run").** Each sprint is
one mod-session plan with one header survey, the readers built together, **one combined 30-minute parity run** and **one
tick-cost run** that cover every reader in the sprint, and one evidence PR to this repo. A reader that misses its
tolerance in the shared run stays on the bridge, and the rest of the sprint switches. The gates per reader (Decision 3)
are unchanged; only the runs and the overhead are shared.

| Sprint | Readers | Why together |
|---|---|---|
| S1 | R0 the rest of power, R1 players, R4 resource nodes | All low difficulty and exact-match. One survey of small classes, and the cheapest first run of the whole process |
| S2 | R2a and R2b factory, R3 trains and train routes | The core data, run on the same large save. The parity run compares factory and trains together; R2b's rate semantics are isolated in the evidence, not in a separate run |
| S3 | R5 rails, R6 conveyors, then R7, the removal release | The geometry and graph layers (R6 joins R2's ids), then the release that deletes the bridge and the dependency |

The first public mod release (answer 3) follows S2, plus R4 from S1.

## S4-B: generators once per read (owner, 2026-10-28)
The owner chose option (a), "once per read", for the S4-B generators list (`power.generators`, contract added in #784).
Re-sending about 1,000 generators with every 5 s power part would spend the whole snapshot byte budget
(`SNAPSHOT_BYTE_BUDGET`, 4 MiB a minute), so the mod reads and sends them only at the factory cadence (`factorySeconds`,
today 30 s). The contract (`packages/shared/src/agent.ts` `AgentPowerSchema`, `packages/shared/src/power.ts` `PowerSchema`):

1. **Agent input.** `generators` sits on the power part of the snapshot in which the sender read them. Present means a read,
   and the list replaces the last one; `[]` means read, none found. Absent means no read in this snapshot: keep the last
   list. The FRM agent never sends generators (unchanged).
2. **Read time.** The read time is the snapshot's own `observedAt`, as the backend already normalises it for every part
   (clamped to the receive time within the clock tolerance). No input field is added, because the list is read in the
   same cycle as the snapshot that carries it.
3. **Backend.** It keeps the last list per server with that time and serves it with later power responses until the read
   is older than 3 × `factorySeconds` (today 90 s, the same three-interval rule as a stale part, ADR-0022). After that,
   and after a new session or power reset, the response leaves `generators` out ("not read"). The list is held apart from
   the stored power part (each power part replaces that part whole, so a part without `generators` must not erase it). A
   late or retried snapshot replaces the list only when its read is newer than the kept one's. An unreachable snapshot
   keeps the list, which still ages by the same rule. The list is **not persisted** (ADR-0052): after a backend restart
   the response omits it until the next read, at most one factory interval, so a restore can never serve an old list
   under a fresh time.
4. **Response.** `PowerSchema.generatorsReadAt` (optional, ISO 8601 UTC, like the envelope's `observedAt`) is the time of
   the read the list came from, so the UI says "read 40 s ago" and never shows an old list as current. It is present
   exactly when `generators` is, and absent from older backends. It is response-only (ADR-0031): a sender's is dropped.

Additive and optional (ADR-0007): old payloads still parse.

## Build tasks (after approval; all in the mod repo unless noted, one PR each, no stacking)

1. Dash repo: commit this ADR, README row, log fragment. This change.
2. Mod: the clean-room contributor note, the PR-template checkbox, the provenance-file CI check.
3. ~~Mod: the similarity workflow~~ **Dropped** (owner, answer 4).
4. Mod and dash docs: per **sprint** (S1, S2, S3, as in the owner's answers), not per reader: header-survey note (dash `raw-sources`), reader plus tests and
   provenance (mod), parity and tick-cost runs (mod CI, owner-approved dispatch), evidence and `mod-claims.md` row (dash),
   then the switch PR (mod).
5. Mod: the removal release R7, then the notes for hosts.

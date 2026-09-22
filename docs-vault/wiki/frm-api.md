# FicsitRemoteMonitoring (FRM) API

Summary derived from `docs-vault/raw-sources/frm-read-api.md` and
`docs-vault/raw-sources/frm-dedicated-server.md` (both captured 2026-09-21 from
docs.ficsit.app).

## Two ways to reach it

1. **FRM Web Server** — FRM's own HTTP server, most requests run off the game thread
   (faster, doesn't block simulation).
2. **Game Port API (tunneled through the vanilla Dedicated Server API)** — same port
   as the vanilla API (default `7777`), reached with
   `{"function": "frm", "endpoint": "<Name>", "data": {...}}` as the POST body. Every
   FRM endpoint reached this way runs on the `GameThread`, so large calls (e.g.
   `getFactory` on a big save) can cause brief server hiccups. Documented as a fallback
   for when the FRM Web Server port isn't reachable, since the game port is required
   to be open anyway for players to connect.

For this project: prefer the FRM Web Server as the primary transport once it's
confirmed reachable in the Phase 2 spike; fall back to the tunneled Game Port API form
only if the Web Server port is blocked. [NEEDS VERIFICATION] — not yet confirmed
whether the deployment target (AWS later) will have the FRM Web Server port open by
default, or whether that needs explicit config.

## Read endpoints, by resource (index only — no field-level schemas captured yet)

Grouped from the endpoint index in `frm-read-api.md`. Endpoints marked "Game Thread:
Yes" can affect server performance under load.

| Resource | Endpoints |
|---|---|
| Factory (production buildings) | `getFactory` (all: smelters/constructors/assemblers/foundries/refineries/manufacturers/packagers/blenders/particle accelerators/encoders/converters), `getExtractor` (miners), `getFrackingActivator`, `getSwitches`, `getRadarTower`, `getResourceSinkBuilding`, `getSpaceElevator`, `getHUBTerminal`, `getElevators`, `getPortal` |
| Belts/pipes/logistics | `getBelts`, `getCables`, `getPipes`, `getPipeJunctions`, `getHypertube`, `getPump`, `getTrainRails` |
| Generators | `getGenerators` (all), `getBiomassGenerator`, `getCoalGenerator`, `getNuclearGenerator`, `getFuelGenerator`, `getGeothermalGenerator` |
| Power | `getPower` (power circuits), `getPowerUsage` (per-building power draw) |
| Inventory | `getCloudInv`, `getWorldInv`, `getStorageInv` |
| Vehicles/logistics stations | `getVehicles`, `getTrains`, `getDrone`, `getTruck`, `getTractor`, `getExplorer`, `getFactoryCart`, `getVehiclePaths`, `getDroneStation`, `getTrainStation`, `getTruckStation` |
| Session/world | `getSessionInfo`, `getPlayer`, `getModList`, `getResearchTrees`, `getRecipes`, `getSchematics`, `getMapMarkers`, `getResourceNode`/`getResourceGeyser`/`getResourceWell`, `getCreatures`, `getDoggo`, `getDropPod`, `getPowerSlug`, `getTapes`, `getUnlockItems`, `getUObjectCount` |
| Sink | `getSinkList`, `getResourceSink`, `getExplorationSink` |
| Chat | `getChatMessages`, `sendChatMessage` (write) |
| Other | `getAll` (bulk fetch of multiple endpoints in one call — worth using for the poll loop to cut request count) |

## Endpoints most relevant to this project's stated goals

Field-level schemas for the five endpoints below are now captured in
`raw-sources/frm-getFactory.md`, `frm-getPower.md`, `frm-getPowerUsage.md`,
`frm-getPlayer.md`, and `frm-getSessionInfo.md`. These are from the docs' documented
response shape + example JSON, not yet cross-checked against a live server response —
that cross-check is the Phase 2 spike's job (see `data-gap-analysis.md`).

- **Production rate** → `getFactory`. Each building returns `production[]` (per
  output item: `CurrentProd`, `MaxProd`, `ProdPercent`) and `ingredients[]` (mirrored
  for inputs: `CurrentConsumed`, `MaxConsumed`, `ConsPercent`), plus `IsProducing`,
  `IsPaused`, `ManuSpeed`. This directly covers "production rate per building" — no
  custom mod needed for this metric.
- **Overflow (belt backed up)** → confirmed no direct "belt is full/backed up" field
  anywhere. `getBelts` (schema captured — `raw-sources/frm-getBelts.md`) only exposes
  geometry, connection state at each end, length, and `ItemsPerMinute` (the belt's
  rated speed, not actual current flow) — no items-in-transit or fullness data. The
  best available proxy is `getFactory`'s `OutputInventory[]` (`Amount` vs.
  `MaxAmount`): a building with `IsProducing: true` and an output inventory sitting at
  `MaxAmount` is backed up, i.e. its downstream belt can't keep up. This is a
  reasonable-but-indirect signal, sourced from documented fields — not
  [NEEDS VERIFICATION], since it's a direct reading of what's documented, but worth
  validating against a live save during the Phase 2 spike since it infers "backed up"
  rather than reading it directly. **Update 2026-09-22: the live save proved the
  `IsProducing: true` condition wrong** (a machine with a full output stops producing)
  — see "Confirmed against a live, populated server" below.
- **Power outage / deficit** → `getPower` (per-circuit: `PowerProduction`,
  `PowerConsumed`, `PowerCapacity`, `FuseTriggered`, plus battery fields
  `BatteryDifferential`, `BatteryPercent`, `BatteryTimeEmpty`) and `getPowerUsage`
  (per-building draw + which circuit). `FuseTriggered` is a direct outage signal;
  `PowerConsumed > PowerCapacity` or `BatteryDifferential < 0` with `BatteryPercent`
  trending down covers "heading toward an outage." This fully covers the stated power
  metrics — no custom mod needed. Also see `frm-config.md`: FRM already ships a
  webhook system (`DiscIT.OutageJSON`, `DiscIT.Battery` threshold levels) that
  overlaps with this project's planned power-outage alerting — worth deciding whether
  to consume FRM's own webhook instead of polling `getPower` ourselves. [NEEDS
  VERIFICATION] — DiscIT's webhook payload shape isn't captured; `getPower` polling is
  documented well enough to build against regardless.
- **Player-specified data generally** → `getPlayer` (position, HP, inventory,
  online/dead state) and `getSessionInfo` (save name, in-game day/time, pause state,
  total play duration) as session/player context around whatever metric is shown.

`getBelts`, `getCables`, `getPipes` and other flow-network endpoints listed in the
index still need their own schema pages captured before the overflow question above
can be answered definitively.

## Confirmed against a live server (Phase 2 spike, 2026-09-21)

Ran against GameVersion 1.2.4.0 (CL 502094), local dedicated server, SML 3.12.0, FRM
1.5.3 (both `WindowsServer` targets, manually installed into
`FactoryGame/Mods/SML/` and `FactoryGame/Mods/GameFeatures/FicsitRemoteMonitoring/`
per `raw-sources/sml-manual-install.md` — FRM's `.uplugin` has `GameFeature: true`,
which determines that path).

- **The tunneled Game Port transport documented in `frm-dedicated-server.md` did not
  work**: `{"function":"frm","endpoint":"getSessionInfo"}` against
  `https://localhost:7777/api/v1` returned `404 bad_function` / `"Payload JSON
  function 'frm' not found"`, even with FRM confirmed loaded (subsystems registered in
  `FactoryGame.log`). See `raw-sources/captured-responses/frm-tunneled-transport-404.md`.
  [NEEDS VERIFICATION] whether this transport was removed in a newer FRM version than
  when the doc was written, or needs config not covered in `frm-config.md`. Until
  resolved, **plan the adapter around the direct FRM Web Server, not the tunneled
  transport**, despite the docs describing the tunnel as the fallback path.
- **The FRM Web Server is not autostarted by default** — `uWS.Autostart` must be set
  to `1` (an int, in `mIntValues`) in
  `FactoryGame/Saved/Config/WindowsServer/GameUserSettings.ini` under the
  `FicsitRemoteMonitoring.Server.uWS.Autostart` key, per `frm-config.md`'s documented
  config keys. Once set and the server restarted, `getSessionInfo`,
  `getPlayer`, `getFactory`, `getPower`, `getPowerUsage`, and `getBelts` all responded
  with `200 OK` and well-formed JSON on plain `GET http://localhost:8080/<endpoint>`
  requests — **no POST envelope, and no auth token required** for this local/insecure
  test setup (unclear whether that's specifically because
  `AllowInsecureLocalAccess=1` was set for the vanilla API, or because FRM doesn't
  enforce its own `uWS.AuthenticationToken` for loopback requests either — [NEEDS
  VERIFICATION] before assuming a remote deployment can skip auth).
- **`getSessionInfo` returns fields not in the doc**: `SpaceElevatorCost`,
  `RecipeCost`, `PowerCost`, `NodeRando`, `NodePurity` all appeared in the live
  response alongside the documented fields. See
  `raw-sources/captured-responses/frm-getSessionInfo-sample.json`.
- **`getFactory`, `getPower`, `getPowerUsage`, `getPlayer`, `getBelts` all returned
  `[]`** — expected, since the test save has no buildings or connected players (this
  spike created a fresh session via the API rather than playing manually). This
  confirms connectivity, HTTP semantics, and that the response is a JSON array as
  documented, but does **not** validate the actual field-by-field shape of a populated
  response. Doing that requires either a human playing on the test server to place
  buildings, or scripting building placement via console commands — out of scope for
  this pass. Treat the field-level docs for these five endpoints as
  doc-sourced-but-not-live-verified, one step more trustworthy than
  [NEEDS VERIFICATION] but not as solid as `getSessionInfo`'s live-confirmed shape.

## Confirmed against a live, populated server (2026-09-22)

Same versions as above, on a tier-6 save with 338 factory buildings and a player
connected, with readings compared field by field against the in-game UI. Evidence is in
`raw-sources/captured-responses/*-2026-09-22-*` (each file's header names its scenario
and what the game UI showed at the time). This supersedes the "not live-verified" caveat
above for `getFactory` and `getPower`.

**Production (`getFactory`)**
- `ProdPercent` / `ConsPercent` are on a 0-100 scale and can exceed 100 through float
  noise (e.g. `100.0000079`), so don't cap them.
- `CurrentProd` / `MaxProd` are per minute, and `MaxProd` already includes clock speed:
  a Stator assembler reads `MaxProd` 5 at 100% and 8 at 160% (`ManuSpeed`).
- Fluid rates are m³/min, the same number the game UI shows (a Fuel refinery at 100%:
  60 Crude Oil in, 40 Fuel + 30 Polymer Resin out).
- `IsProducing` is instantaneous, while `CurrentProd`/`ProdPercent` look averaged: many
  machines read `IsProducing: false` with a non-zero percent. Show percent; don't treat
  `IsProducing` as "running".
- `production[].Amount` is a number (`frm-getFactory.md` says String), and there is an
  undocumented `MaxAmount` field.
- An unconfigured machine reports `Recipe: "Unassigned"`, `RecipeClassName: ""`,
  `IsConfigured: false`, and one placeholder `production` entry named "Unassigned" with
  all zeros. `IsConfigured` is not in the docs.

**Overflow (`getFactory` `OutputInventory`)**
- **A machine whose output is full stops producing.** In the running capture, 71
  machines had an output slot at `Amount == MaxAmount`, and every one of them had
  `IsProducing: false`. So the documented proxy above ("`IsProducing: true` and output
  at `MaxAmount`") never fires. The working signal is: an output slot at `MaxAmount`,
  the machine not paused, and the machine configured.
- **`OutputInventory` lists only non-empty slots.** Across three full captures (557
  slots), no slot had `Amount` 0. `[]` means "output buffer empty right now", not "this
  machine has no output inventory".
- Fluid outputs do appear there when their buffer is non-empty: a Fuel refinery showed
  `{Name: "Fuel", Amount: 3.2, MaxAmount: 50}`, and `[]` in the next capture. So a
  blocked refinery should be detectable the same way. [NEEDS VERIFICATION] with a
  deliberately blocked refinery.
- `MaxAmount` is not a solid-vs-fluid signal: solids such as Motor and Smart Plating
  also have `MaxAmount` 50. No per-item solid/fluid source has been found in
  `getFactory`.

**Power (`getPower`, `PowerInfo`)**
- `PowerProduction` / `PowerConsumed` / `PowerCapacity` / `PowerMaxConsumed` are in MW
  and match the in-game power-pole panel exactly (3633.3 / ~2744 / 4083.3 / 4606.5).
- `PowerConsumed` excludes battery charging, which is reported separately as
  `BatteryInput`.
- A tripped fuse reads `FuseTriggered: true`, and production, consumption and capacity
  all read 0 (`PowerMaxConsumed` keeps its value).
- `getPower` reports circuit **groups**: `AssociatedCircuits` lists the member circuits
  (a power switch gave `[0, 3]`). Buildings carry both `CircuitGroupID` and `CircuitID`,
  and they differ when a switch or group is involved (a building read 1 vs 2), so join
  buildings to `getPower` on `CircuitGroupID`. `-1` means not connected, as documented.
- With no batteries, `BatteryPercent` / `BatteryDifferential` / `BatteryCapacity` are all
  0, not null, so "0%" is ambiguous unless `BatteryCapacity` is also checked.
- `BatteryPercent` is 0-100 (2.33 then 2.90 twenty seconds later, while the game UI
  showed ~1-2%). `BatteryDifferential` / `BatteryInput` are MW, positive while charging;
  `BatteryCapacity` is MWh. The numbers agree: 100 MW for 20 s = 0.56 MWh = +0.56% of
  100 MWh. `BatteryTimeFull` / `BatteryTimeEmpty` are `"HH:MM:SS"` strings and count
  down correctly.

**Pause and clients**
- With the server's `FG.DSAutoPause` on and no players connected, the simulation pauses
  and FRM returns frozen values. The vanilla API's `isGamePaused` shows this (see
  `vanilla-dedicated-server-api.md`).
- FRM's `.uplugin` declares `RequiredOnRemote: false`, but a game client without FRM is
  disconnected on join (client log: "Failed to resolve path ...
  /Script/FicsitRemoteMonitoring"). Anyone joining an FRM server needs SML + FRM
  installed too.

Still [NEEDS VERIFICATION]: whether building IDs stay stable across a server restart;
whether Polymer Resin is counted as items/min or m³/min; a reliable per-item
solid-vs-fluid source (possibly an FRM item/recipe endpoint not yet captured); and the
blocked-refinery case above.

## Full reference

See `docs-vault/raw-sources/frm-read-api.md` (endpoint index) and
`docs-vault/raw-sources/frm-dedicated-server.md` (tunneled-transport details, request
examples). Per-endpoint schema pages still need to be captured — see
`docs-vault/wiki/data-gap-analysis.md` and the log for status.

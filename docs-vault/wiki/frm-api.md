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
  rather than reading it directly.
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

## Full reference

See `docs-vault/raw-sources/frm-read-api.md` (endpoint index) and
`docs-vault/raw-sources/frm-dedicated-server.md` (tunneled-transport details, request
examples). Per-endpoint schema pages still need to be captured — see
`docs-vault/wiki/data-gap-analysis.md` and the log for status.

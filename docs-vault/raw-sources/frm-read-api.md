Source: https://docs.ficsit.app/ficsitremotemonitoring/latest/json/Read/Read.html
Captured: 2026-09-21. Trimmed 2026-09-27 (#343).

FicsitRemoteMonitoring's docs carry no licence (all rights reserved), so this file keeps only the
excerpts this repo cites, verbatim, numbered E1, E2, ... Cite them as `frm-read-api.md` E<n>, never by line
number. The full page is at the source URL; a full copy of the 2026-09-21 capture is kept outside
the repo, and this file's git history has it too.
E2 keeps the index's Resource, Endpoint and Game Thread columns; the links and descriptions are dropped.

---

### E1 — The page's introduction

## API (Read)

Some endpoints are new and not yet documented.

List of all read endpoints:

### E2 — Endpoint index: which endpoints run in the game thread

| Resource | Endpoint | Game Thread |
| --- | --- | --- |
| Chat | getChatMessages | Yes |
| Factory | getAssembler | No |
| Factory | getBlender | No |
| Factory | getConstructor | No |
| Factory | getConverter | No |
| Factory | getElevators | No |
| Factory | getEncoder | No |
| Factory | getFactory | No |
| Factory | getSmelter | No |
| Factory | getRefinery | No |
| Factory | getManufacturer | No |
| Factory | getPackager | No |
| Factory | getParticle | No |
| Factory | getFoundry | No |
| Factory | getBelts | No |
| Factory | getCables | No |
| Factory | getHypertube | No |
| Factory | getPipeJunctions | No |
| Factory | getPipes | No |
| Factory | getPump | No |
| Factory | getTrainRails | No |
| Factory | getExtractor | Yes |
| Factory | getFrackingActivator | Yes |
| Factory | getPortal | No |
| Factory | getRadarTower | No |
| Factory | getResourceSinkBuilding | No |
| Factory | getSpaceElevator | No |
| Factory | getHUBTerminal | Yes |
| Factory | getSwitches | No |
| Generators | getGenerators | No |
| Generators | getBiomassGenerator | No |
| Generators | getCoalGenerator | No |
| Generators | getNuclearGenerator | No |
| Generators | getFuelGenerator | No |
| Generators | getGeothermalGenerator | No |
| Inventory | getCloudInv | No |
| Inventory | getWorldInv | No |
| Inventory | getStorageInv | No |
| Resource Nodes | getResourceNode | Yes |
| Resource Nodes | getResourceGeyser | Yes |
| Resource Nodes | getResourceWell | Yes |
| Session | getSessionInfo | Yes |
| Session | getResearchTrees | Yes |
| Session | getPlayer | Yes |
| Session | getModList | No |
| Sink | getSinkList | Yes |
| Sink | getResourceSink | No |
| Sink | getExplorationSink | No |
| Stations | getDroneStation | No |
| Stations | getTrainStation | No |
| Stations | getTruckStation | No |
| Vehicles | getDrone | Yes |
| Vehicles | getExplorer | Yes |
| Vehicles | getFactoryCart | No |
| Vehicles | getTractor | No |
| Vehicles | getTrains | No |
| Vehicles | getTruck | No |
| Vehicles | getVehiclePaths | No |
| Vehicles | getVehicles | No |
| World | getCreatures | No |
| World | getDoggo | Yes |
| World | getDropPod | Yes |
| World | getMapMarkers | No |
| World | getPowerSlug | Yes |
| World | getProdStats | No |
| World | getRecipes | Yes |
| World | getSchematics | Yes |
| World | getTapes | No |
| World | getUnlockItems | Yes |
| World | getUObjectCount | No |
| Power | getPower | No |
| Power | getPowerUsage | No |
| Other | getAll | Mixed |

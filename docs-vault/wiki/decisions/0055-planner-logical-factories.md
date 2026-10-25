# ADR-0055: Logical factories and multi-modal transport in the planner

Status: **accepted** (owner, 2026-10-24): questions 1, 2, 4, 5 and 6 as recommended; question 3 as option C (fold only
dependent offshoots, Decision 6). **Amends ADR-0053**: replaces
its Decision 2 (sites from supply edges) and Decision 7 (build PRs), extends Decisions 4, 5 and 6; Decisions 1 (flow
classes) and 3 (bubbles of recipe x source tree) stand, with bubbles scoped per factory instead of per site. Also
amends ADR-0050 Decision 6 (logistics edges) and Decision 8 (player-named sites become designated factories). Paths are
under `backend/src/modules/` unless they start with a top-level directory.

**Why amend and not supersede ADR-0053:** its flow classes and source trees are inputs to this design, it is still
proposed with its four owner questions open, and only one of its six decisions is replaced. A superseding ADR would
restate five decisions to change one.

## Context

The owner's brief, 2026-10-24, verbatim: "Id rather not rely on polling rate data from the belts that can get expensive.
My thoughts were this ideally, choose algorithms that can help achieve this, and determine where the compute should
happen in our production/workflow. Ideally, A complex factory can transport items via vehicle, train, belt, drone. This
logic should be available somehow. We should be able to tell when a resource is going to storage/personal storage (via
the mercer sphere storage thing) or another part of the factory. By default, we collapse factory nodes 'logically' but
not via an agent (some kinda algorithm or decision tree). Needs to capture that a 'modular frame factory' should include
the very far raw material storage being produced by a raw material farm (for example, by the water using the pure
recipes), but still classify it as under the 'modular frame factory' despite the extractors distance from the
'factory'. Consider vehicles and drones. Let storage nodes be toggleable to hide detail if needed (for example doing an
analysis on a factory). Users should be able to use a tool to sketch a circle around the nodes they consider to be one
'factory' and a button where we try to reason the factories ourselves (if a user has a factory designated, can exclude
from our reduction). Another option is to have the ability to click on a node and collapse the subtrees behind it? We
can use icons and whatnot for transport if its by train, drone or vehicle (replacing the edge). Could even be animated.
Need ability to toggle animations/visuals if so."

### Measured structure (the owner's save, 2026-10-24, the backend's own builder on a read-only copy)

| Measure | Value | What it means for the design |
| --- | --- | --- |
| Whole save | 340 buildings, about 2,400 conveyor segments, 210 groups, 6 sites | Small: every algorithm below is linear or close to it |
| "Versatile Framework site" | 385 machines, 160 groups, 204 edges | The unit that is hard to read today |
| Its weak components | **10, merged only by the 150 m rule** (`telemetry/services/productionGraph.ts:535-547`) | Distance glues unrelated lines; factories must come from flow, not distance |
| Storage | 46 of 160 groups (29%), 21 storage-to-storage links | Storage folding and a storage toggle are needed now |
| Degree | mean in/out 1.27; 94 groups with out-degree 1; hubs with fan-in 9, fan-out 8 | Mostly chains (subtrees collapse well); a few shared suppliers need splitting by share |
| Bridges | 91 of 204 edges | Nearly a tree: bridges flag almost everything, so they are not a useful badge (Decision 8) |
| Loops | 2 two-node loops | SCC condensation is cheap and rarely matters |
| Depth | 8 layers, widths 30 29 26 22 27 14 9 3 | Layered layout fits; a factory level cuts the width |
| Repeated recipes | Crystal Oscillator x8 groups, Iron Plate x7 | Bubbles (ADR-0053 Decision 3) stay inside factories |
| Unknown items | 77 of 204 edges (38%): extractor to machine 24, storage to storage 21, storage to machine 14 | Shares need items: ADR-0053 Decision 4 plus storage contents (Decision 1) |

### What the data gives, without per-belt rates

FRM has no live per-belt throughput: `getBelts` carries the tier's `ItemsPerMinute` and `Length`, static
(`packages/shared/src/map.ts:143-162`, `raw-sources/captured-responses/frm-getBelts-2026-10-21-connections-trimmed.json`).
Flows are inferred from the machine side instead: every machine's `production` and `ingredients` with
`currentPerMinute` and `maxPerMinute` are in the 30 s snapshot (`packages/shared/src/factory.ts`), and the topology is
the 10-minute `conveyors` layer (`agent/src/worldReader.ts:15-16`). That is the whole design's premise: **flow is
demand-side, from machine rates; topology is static, from the world tier; nothing polls belts for rates.**

| Source | FRM endpoint | Game thread (`raw-sources/frm-read-api.md` E2) | Read today | Fields that matter | Evidence |
| --- | --- | --- | --- | --- | --- |
| Train stations, freight platforms | `getTrainStation` | No | Every 30 s as `mapLive`, projected to id, name, x, y only (`localWorldPoller.ts:27,39`; `packages/game-adapter/src/map/stationsMapper.ts:25-30`) | Per platform `ID`, `LoadingMode` Loading/Unloading, `Inventory`; station `Name` | `frm-getTrainStation-2026-10-21-trimmed.json`; gate passed: platform ids equal belt end ids (`raw-sources/frm-train-gate-2026-10-21.md`, check 1) |
| Trains, timetables, cargo | `getTrains` | No | Every 30 s as `mapLive`, timetable and cars dropped (`trainsMapper.ts:20-31`) | `TimeTable[].StationName`, `Vehicles[].Inventory` | `frm-getTrains-2026-10-21-trimmed.json`; names resolve uniquely on this save, kept with their trailing space (gate check 2) |
| Train rates | the same | | | `TransferRate`, `InflowRate`, `OutflowRate` | `[NEEDS VERIFICATION]` (gate check 3): train edges carry no measured rate |
| Truck stations | `getTruckStation` | No | No | `LoadMode`, `Inventory`, `DockVehicleCount`, location; no vehicle or path link (FRM docs page `getTruckStation`) | `[NEEDS VERIFICATION]`: no capture (CAP-4) |
| Trucks, tractors | `getVehicles` (also `getTruck`, `getTractor`) | No | No | `Autopilot`, `PathName`, `Route`, `NextStop`, `Inventory` (FRM docs page `getVehicles`) | `[NEEDS VERIFICATION]`: the 2026-09-27 capture is `[]` |
| Truck paths | `getVehiclePaths` | No | No | `ID`, `Name`, `PathPoints[]` (x, y, z), `PathLength` (FRM docs page) | `[NEEDS VERIFICATION]`: no capture |
| Drone ports | `getDroneStation` | No | No | `PairedStation` (a name, "None" if unset), `InputInventory`, `OutputInventory`, `FuelInventory` (FRM docs page) | `[NEEDS VERIFICATION]`: no capture |
| Drones | `getDrone` | **Yes** | No | Not needed: the pairing is on the port | `frm-getDrone-2026-09-27-empty.json` is `[]`; never read (game thread) |
| Dimensional Depot uploaders | none needed | | Already a `storage` end in `conveyors` by class `Build_CentralStorage…` (`packages/game-adapter/src/map/conveyorsMapper.ts:45`) | The class tells "uploader" apart from a container | The class name on the owner's save `[NEEDS VERIFICATION]` (one grep of the stored layer) |
| Depot contents | `getCloudInv` | No | No | `Name`, `ClassName`, `Amount`, `MaxAmount`, `Limit` (FRM docs page) | Not needed for the graph; not yet |
| Container contents | `getStorageInv` | No | No | Per container `ID`, `Inventory[]` (FRM docs page) | `[NEEDS VERIFICATION]`: no capture, size unknown; the cheapest fix for the 35 storage-sourced unknown items |
| Recipe catalogue | `getRecipes` | **Yes** | No | Not needed (Decision 8) | |

The FRM docs carry no licence; this ADR cites field names from the pages under
`https://docs.ficsit.app/ficsitremotemonitoring/latest/json/Read/` and copies nothing else. A field from a docs page
and not a capture stays `[NEEDS VERIFICATION]` until the capture lands.

## Decision

### Decision 1: logistics configuration as world layers on the 10-minute tier, each behind its capture

Transport configuration changes when the player edits a timetable or a port, like topology, so it rides the world tier
(10 min, jittered, hash-deduplicated: an unchanged layer writes nothing, `map/services/worldIngestService.ts`), never
the 30 s snapshot. All endpoints below are not game-thread. One layer per mode, so each lands when its capture does:

| Layer | Read from | Projected to | Gate |
| --- | --- | --- | --- |
| `trainRoutes` | `getTrainStation` + `getTrains` | stations `{id, name, platforms: [{id, mode, items: className[]}]}`, trains `{id, name, stops: stationName[], items: className[]}` | **Open now**: the 2026-10-21 capture passed checks 1 and 2 |
| `storageContents` | `getStorageInv` | `[{id, items: className[]}]` (distinct classes, no amounts) | A trimmed read-only capture on the owner's save (size, id equals belt end id) |
| `droneRoutes` | `getDroneStation` | `[{id, name, paired: name or null, input: className[], output: className[], x, y}]` | Designed from the FRM docs fields; see "Drones and trucks without a save" below |
| `truckRoutes` | `getTruckStation` + `getVehiclePaths` + `getVehicles` | stations `{id, mode, items, x, y}`, paths `{id, name, points (whole metres, thinned)}`, vehicles `{pathName, autopilot}` | The same |

**Drones and trucks without a save.** The owner uses trains but has no save with drones or trucks (2026-10-24: "need to
pull from game code to know/guess"). So these two layers are designed from the names the game and FRM expose, not from
a capture: FRM's docs pages for `getDroneStation`, `getTruckStation`, `getVehicles` and `getVehiclePaths` (field names
in the table above), and the game's own model, where a drone port is paired with one destination port and a truck
follows a recorded path, docking at the truck stations on it. The game's class and property names behind those fields
(FactoryGame headers, as shipped with SML's starter project) are `[NEEDS VERIFICATION]`: no header or game-data dump is
in `raw-sources/` today. The adapter session adds one (the relevant class and property names, trimmed, cited) before
PR 11 and PR 12. Until a real response is seen:

- the raw schemas are lenient (every field optional, unknown fields ignored), and a response that does not fit drops
  the layer with a warn log. It never fails the planner;
- the tests use synthetic fixtures built from the docs field names, marked as such in their file header;
- the response says `logistics: "partial"` and the legend says "drone and truck routes are inferred from configuration
  and not yet checked on a real save";
- verification happens on the core mod's separate test install, which can carry a test save with one drone pair and
  one truck route, or on the first real save that has them. Never on the owner's live save without his OK.

- **Who reads:** the agent's world reader (`agent/src/worldReader.ts`) and the backend's local poller
  (`map/services/localWorldPoller.ts`), through one game-adapter projection each (`packages/game-adapter/src/map/`),
  exactly as rails and conveyors. The raw schemas grow the fields they drop today (`packages/game-adapter/src/rawSchemas.ts:246-260`).
  The core mod (the sibling mod repository) emits the same layer contract from the game objects natively, at the same
  cadence, inside its tick-cost budget; the contract does not care which producer sent it.
- **Cost:** four small reads every 10 min [estimate from the 2026-09-27 volumes: stations 4.4 KB, trains 1.4 KB,
  `wiki/frm-endpoint-volumes.md`]; storage contents is unmeasured (the capture says). No game-thread endpoint is read.
- **Not read:** `getDrone`, `getExtractor`, `getRecipes` (game thread), `getCloudInv` (no graph use; trigger: the owner
  asks for depot stock in the planner).

### Decision 2: one logical edge per transport route, typed by mode

The planner's edges become `belt | pipe` (today, `PlannerEdge.kind`) plus **transports** `train | truck | drone | depot`,
in their own array (Decision 9), each from a source node to a destination node, carrying one item:

- **Train:** for each train, walk its timetable cyclically. An item `X` loaded at station A (a `Loading` platform whose
  inventory or belt-fed item is `X`) goes to each later stop B, before the train returns to A, that has an `Unloading`
  platform whose inventory holds `X` or whose downstream consumes `X`. The edge is platform group to platform group, so it
  attaches to the belts at both ends (gate check 1). Trains on the same (A, B, X) merge into one edge with `carriers: n`.
  A timetable name that matches no station or two stations makes no edge and a note ("station name used twice: …"),
  never a guess (gate check 2). Stop filters are not in the capture `[NEEDS VERIFICATION]`; with them, the rule would
  use the filter instead of inventories.
- **Drone:** port A's `PairedStation` resolves by name to port B (same duplicate rule). Items in A's input inventory, or
  fed into A by belt, go A to B; B's input goes B to A (the return trip).
- **Truck:** a vehicle's `PathName` names a path; a truck station within 15 m of a path point [estimate, tuned on the
  capture] is a stop, in path order. Loading stops send their items to later unloading stops, as trains.
- **Depot:** every uploader node gets one `depot` edge to a single virtual node, "Dimensional Depot", per server. Its
  items are what the uploader receives.
- **Rates:** never from `TransferRate` and friends (unverified). A transport edge's rate is the downstream demand it
  serves, from machine rates (Decision 4, the same rule as belts), `estimated` at best.
- **Station platforms become pass-throughs** for item inference and factories once their route is read (ADR-0053
  "Revisit when", last bullet), and stay terminals with destination `export` when it is not.

### Decision 3: every flow ends somewhere named

Each edge (belt, pipe or transport) gets a `destination`, after ADR-0053 Decision 1's flow class (supply, excess,
output):

| Destination | Rule (on the destination node) |
| --- | --- |
| `factory` | A machine group, or a buffer (storage or platform with outgoing supply) on the way to one |
| `storage` | A terminal container or tank (no outgoing edges); when storage detail is off it is shown as a chip on the producer |
| `depot` | An uploader, through the virtual Dimensional Depot node |
| `sink` | `Build_ResourceSink…` (today a `consumer`, `conveyorsMapper.ts:44`). The owner's answer to ADR-0053 Question 1 (2026-10-24): "Recycler is just awesome sink i think". So the sink is the recycler and excess terminal, and `TERMINAL_RECIPES` stays empty. No `recycler` value is emitted unless game data shows a recycling building |
| `power` | A generator (a `consumer`) |
| `export` | A station, drone port or truck station whose route is not read |
| `unknown` | `other` and anything else |

Text form and tooltips say it in words: "Excess Iron Plate to the AWESOME Sink", "Modular Frame to the Dimensional
Depot".

### Decision 4: logical factory reduction, deterministic, by final product and flow share

Run per weak component of the **logical supply graph** (groups, supply edges and transport edges; terminals hang off it).
No distance rule: the 10 components the 150 m rule merged in the measured site are separated, and a remote farm joined
by a train is in the same component as the factory it feeds. Steps, each a pure function:

1. **Fold buffers (series reduction).** A buffer storage or platform is contracted into its in-edges times out-edges, per
   item, so storage-to-storage chains (21 links in the measured site) disappear from the reduction. The folded nodes keep
   their `factoryKey` for display.
2. **Condense loops.** SCCs (already computed, `productionGraph.ts:498-505`) become one node; members share its result.
3. **Seeds.** A machine group is a seed when it has an `output` edge (its product leaves the supply graph: storage, depot,
   sink, export) or a product nobody consumes. `excess` edges do not make seeds (an overflow is not a product line).
   Seeds of the **same product** whose upstream closures share a non-raw node merge (ADR-0053 Decision 3's union rule);
   disjoint ones are separate factories.
4. **Design-rate shares.** For each node, a share vector over factories, computed in reverse topological order: a seed's
   is 1 for its factory; any other node's is the sum over its supply out-edges of
   `weight(edge) x share(destination)`, where `weight` is the edge's fraction of the node's output at **max rates**
   (`maxPerMinute`, not current). Edge weight: the destination's max demand for the item, split between its suppliers in
   proportion to their max output (ADR-0050 Decision 2's rule, on max values). Max rates change only with a recipe,
   clock or build, so the result is stable between topology changes and never flickers with a starved machine.
   Edges whose item or rate is unknown take the remainder of the node's output in equal parts; a node with no rate data
   at all (an extractor, a storage) splits equally. Excess and output edges are left out of the denominator.
5. **Assign.** A node's home factory is its largest share. Ties (within 0.001): the factory whose seeds have the larger
   max output, then the lower factory key. A node whose largest share is under 0.95 is `shared` and lists its top shares
   (at most 4, the rest summed as "other").
6. **Fold small dependent factories** (owner, 2026-10-24: option C). A factory with fewer than `MIN_FACTORY_MACHINES`
   (4) home machines folds into another factory only when it is a **dependent offshoot**: every supply input of its
   home nodes comes from that one other factory. Its product is listed there as a side product, "Iron Plate factory
   (+ Iron Rod)". A small factory keeps its own compact card when it has its own extractors, inputs from more than one
   factory, or an output that leaves by train, truck, drone, the Depot or the sink. Designated factories and power
   never fold. A folded side product can be popped out into its own card, which saves it as a designation.
7. **Collapse targets (post-dominators).** Per factory, add a virtual exit after its seeds and compute post-dominators
   on its supply subgraph (Cooper, Harvey and Kennedy's iterative algorithm). A node's `collapseUnder` is its immediate
   post-dominator: the nearest node every one of its paths to the factory output goes through. "Collapse upstream" on a
   node hides everything it post-dominates; a shared supplier is never hidden by one consumer.
8. **Name.** A designated factory: the player's name. Otherwise the seed product: "Modular Frame factory"; extractors
   feeding only storage or the depot: "Iron Ore farm"; a repeated name gets an ordinal by machine count, then key ("Iron
   Plate factory 2"). `factoryKey` is `factory|<product class>|<snapped centroid of its seeds>`, valid for one response,
   like every key today.

**Distance does not enter.** A water extractor 2 km away feeding only the Pure Iron Ingot refineries of the Modular Frame
line has share 1 for that factory and is assigned to it. Sites (ADR-0050 Decision 8) stay as a location label ("in
Versatile Framework site") and for the map; they no longer decide grouping, so ADR-0053 Decision 2 is not built.

**Worked example.**

```
Farm, 2 km away:  M (Miner x4, Iron Ore) -> K1 (Storage) -> L (Loading platform) ==train==> U (Unloading platform)
Main base:        U -> K2 (Storage) -> R (Refinery x6, Pure Iron Ingot) <- W (Water Extractor x3)
                  R -> P (Constructor, Iron Plate) -> A (Assembler, Reinforced Plate) -> F (Assembler, Modular Frame) -> S (Storage)
                  R -> D (Constructor, Iron Rod) -> F ;  D -> C (Constructor, Screw) -> X (Computer line) -> T (Storage)
                  P -> overflow -> Sink
```

Seeds: F (Modular Frame to storage S) and the Computer line X (to T). At max rates R's ingots go 75% to the frame side and
25% to the screws, so R, W, K2, U, the train, L, K1 and M all get {Modular Frame 0.75, Computer 0.25}: home Modular Frame
factory, `shared`, the farm included despite its distance. P's overflow to the sink is `excess`, destination `sink`, and
seeds nothing. Collapse upstream on F hides A, P and D (each reaches the output only through F) but not R (it also
feeds C).

**Validation without a labelled set.** The owner declined to hand-label his factories as ground truth (2026-10-24, too
much time). So correctness is shown by invariants, tested on generated graphs in the unit tests and asserted at run time
on real saves, plus the measured statistics:

| Invariant | Test |
| --- | --- |
| Every machine group is in exactly one factory; shares of each node sum to 1 (within 1e-9) | Every generated graph |
| Determinism | Byte-identical output on shuffled nodes, edges and ids |
| Distance invariance | Translating a component, or moving a farm 5 km away, changes nothing |
| Rate-noise invariance | Changing only `currentPerMinute` leaves factories, shares and the topology hash unchanged |
| Monotone attribution | Adding an extractor that feeds only factory F puts it in F; adding a second consumer factory can only lower F's share |
| Designations are fixed | No designated machine is ever assigned elsewhere |
| Post-dominator soundness | Hiding what a node post-dominates never hides a node with a path to the output that avoids it |
| Seeds | The factory count is between 1 and the seed count of each component; a component without seeds is one factory |

PR 6b logs, per save, the factory count, factories per weak component, shared-node count and largest share spread,
the largest factory's machine count, unassigned groups (must be 0) and the run time, as `ProductionGraphStats` does
today. The PR records them for the owner's save next to this ADR's measured table (factories never cross a weak
component, so the measured site's 10 components must give at least 10 factories). Property tests use a small seeded
generator in the test file (no new dependency).

**Cost.** Folding, SCC and seeds are linear. Shares are O(F x (V + E)) per component with sparse vectors, and on a
near-tree most vectors have one entry. Post-dominators: a few linear passes in practice. Measured save: 210 groups and
a few tens of factories [estimate: well under 5 ms]; PR 6's generated-10x test bounds it as ADR-0050 Decision 5 does.

### Decision 5: designated factories, stored per server, anchored by machine position

- **Designate:** a lasso tool on the planner canvas selects the cards (and so the machines) inside the drawn shape;
  the text form offers the same with checkboxes and "Designate selected" (keyboard and narrow screens). A name dialog
  follows. Owner and admin only, through the existing guard (`servers/serverAccess.ts:49-50`); members see them.
- **"Reason factories for me":** automatic factories (Decision 4) are always computed for everything not designated, and
  the button shows them as suggestions (dashed frames) with "Keep" per factory, which saves the suggestion as a
  designation. Designated machines are fixed to their factory and excluded from the reduction; they act as seeds
  (whatever leaves the designation is its output), so a designated factory still pulls in remote upstream by share
  (mode `core`, Question 1).
- **Stored form:** table `map.factory_designations (server_id uuid REFERENCES servers.servers ON DELETE CASCADE, id uuid,
  name text 1..64, mode text, members jsonb, created_at, updated_at)`, members an array of `{c: className, x, y}` in
  whole metres, at most 1,000 per designation and 50 designations per server [cap estimate: the measured site is 385
  machines]. A few KB per designation. This replaces ADR-0050 Decision 8's `map.site_names`, not built yet: a designated
  factory is a named site that follows the flow. Expand-only migration (ADR-0049), on the server-removal purge list
  (`servers/repositories/serverRepository.ts:212-219`), no user id stored (an audit event instead, as ADR-0050 Decision 8),
  names rendered as text only. User-authored configuration, not telemetry: ADR-0052's "a cache, not a database" is about
  snapshots and does not apply; nothing here holds game state beyond class names and positions the player chose.
- **Why positions and not ids:** a rebuilt belt gets a new id (G-B1, `raw-sources/frm-conveyor-gchecks-2026-10-21.md`),
  and building id stability across restarts is `[NEEDS VERIFICATION]` (`packages/shared/src/factory.ts:42-44`). A
  machine deleted and rebuilt in place has a new id but the same class and position. Matching on read: exact
  `(class, x, y)`, else the nearest machine of that class within 2 m, one-to-one, in member order.
- **Conflicts:** a write whose members overlap another designation is refused (409, naming the other one). An overlap on
  read (drift after a rebuild) goes to the older designation, and the newer says "N machines claimed by …". Members not
  found: "N machines no longer found", with a clean-up action; all missing: listed as unmatched, never deleted silently.
  A new machine next to a designated factory is not added; it is attributed by share and marked "automatic", with "Add to
  this factory".
- A group whose machines fall in and out of a designation splits along it (the designation id joins the group key,
  `productionGraph.ts:247-266`).

### Decision 6: what the viewer sees

- **Top level: factories** (instead of the site overview): one card per factory with its products (actual over max), its
  machine count, the sites it spans ("Main base + 1 remote"), a `shared` badge count, and destination chips ("to storage
  3, to the depot 1"). Edges between factories are the cross-factory supply and transport edges.
- **Open a factory:** its bubbles (ADR-0053 Decision 3, now per factory), remote parts marked with their site and
  distance ("12x Water Extractor, 1.8 km, by train"); shared nodes show their split ("75% here, 25% Computer factory").
- **Collapse upstream:** on any node (context action, or a key on the focused card) hides what it post-dominates into a
  "+N" badge on it; Escape or the badge restores. Session UI state keyed by node key, as ADR-0053's expansion set.
- **Storage detail toggle:** off folds buffers into their edges and terminal storage into chips. Default off at the
  factory level, on inside an opened factory. Per viewer in `localStorage` (`planner.storageDetail`).
- **Transport edges:** drawn as the edge with a mode icon (train, truck, drone, depot) at its midpoint replacing the
  belt styling, labelled in the text form and the tooltip ("Train: Quartz Crystal, Silica/Crstal Out to
  Computer-Dropoff"). Inline SVG glyphs in token colours, no new dependency, no new colour meaning (ADR-0041).
- **Animation:** optionally the icon moves along the edge (SVG `animateMotion` or CSS classes; no inline style strings,
  `script-src 'self'` and `style-src 'self'` hold, `frontend/public/_headers:6`, the e2e CSP gate proves it). A
  "Motion" toggle, Off / On / System, stored per viewer in `localStorage` (`planner.motion`), System by default:
  `prefers-reduced-motion: reduce` means off. Only visible transport edges animate, and nothing runs while the tab is
  hidden.

### Decision 7: where the compute happens

| Work | Where | Why | Cadence |
| --- | --- | --- | --- |
| Reading logistics configuration | Agent or core mod (agent servers), backend local poller (local servers) | Only they reach the game; projections keep payloads small | 10 min, hash-deduplicated |
| Graph, flows, items, transport edges, reduction, post-dominators | Backend, one pure function (`productionGraph.ts` calling new modules) | One source of truth for canvas and tables; the inputs are already there; the frontend would need the 647 KB conveyors layer (ADR-0050 Decision 1) | Per request, as today |
| Topology hash | Backend, in the response | Lets the browser skip a re-layout when only rates changed | Per request |
| Aggregation, collapse, storage toggle, layout | Browser (dagre in the lazy chunk; a worker only at ADR-0050's 100 ms trigger) | Depends on viewer state | On interaction |

- **Not in the agent:** reduction there would duplicate the code in a second runtime and leave local servers without it.
- **Cache: not yet.** Trigger: the 10x test or a production request passes 50 ms (ADR-0050 Decision 5). Cheap step now:
  the topology hash (conveyors layer hash, logistics layer hashes, a hash of the sorted (id, class, recipe, clock) of
  the snapshot's buildings, the designations' `updated_at`) is computed and returned, so the cache, when needed, is a
  one-entry memo per server keyed by it. Shares use max rates (Decision 4), so the whole reduction depends only on that
  hash; current rates are applied after.
- **Free plan:** no new game-thread reads, a few KB more every 10 min per server, a few ms of backend CPU per planner
  request (only while the tab is open), one small table.

### Decision 8: algorithms adopted and rejected

| Algorithm | Verdict | Use |
| --- | --- | --- |
| Union-find, weak components | **Adopt** (exists, `connectionGraph.ts:172-207`) | Components of the logical supply graph |
| SCC condensation, topological order | **Adopt** (exists) | Loops; share order |
| Series reduction | **Adopt** | Buffer and storage chains (Decision 4 step 1) |
| Proportional flow attribution | **Adopt** | Shares by design rate: the input-output (Leontief) allocation, linear on a DAG |
| Post-dominators (Cooper-Harvey-Kennedy) | **Adopt** | Collapse upstream; "everything that depends only on this" (ADR-0050's deferred dominator row, now triggered by the brief) |
| Per-item balance (arithmetic) | **Adopt** | Per factory: max production minus max consumption per item, "Iron Ingot +30/min at full speed"; recipe ratios come from the snapshot's in-use recipes (max rates divided by clock), no catalogue |
| Linear programming, generalized flow | **Not yet** | "How many machines for X/min, with alternates" needs the full recipe catalogue. Trigger: the owner asks for targets. Source then: the game's CommunityResources Docs, as ADR-0015's form catalogue, not `getRecipes` (game thread) |
| Min-cut with static capacities | **Not in the planner** | The finder already runs Dinic per machine (`bottleneckFinder.ts`); the planner links findings by machine id (ADR-0050). A factory-level cut over several items is a generalized flow problem, not max-flow |
| Bridges | **Rejected** | 91 of 204 edges are bridges: the badge would be everywhere. Post-dominators are the directed, useful form |
| Dijkstra, A* | **Rejected** | No cost to minimise and no goal to search for; reachability already answers "where does this go". Truck stops come from point-to-path distance, not search |
| Clustering by position (k-means, DBSCAN) | **Rejected** | The brief is the counter-example: a remote farm belongs to the factory it feeds |

### Decision 9: contract changes, additive (ADR-0007), in one contract PR with ADR-0053 Decision 5

Plain strings with known values for every new enum-like field (as `PlannerNode.kind`), so a newer value never breaks an
older frontend. `PlannerEdge.kind` stays `belt | pipe` (a closed enum, widening it would break older frontends);
transports get their own array.

```ts
// packages/shared/src/productionGraph.ts (every field optional: absent = older backend)
PlannerNodeSchema += {
  factoryKey: Key.optional(),
  shares: z.array(z.object({ factoryKey: Key, share: z.number().min(0).max(1) })).max(5).optional(), // only when shared
  collapseUnder: Key.nullable().optional(),  // immediate post-dominator in its factory
  role: z.string().max(20).optional(),       // known: buffer | storage | depot | sink | power | export
};
PlannerEdgeSchema += { destination: z.string().max(20).optional() }; // Decision 3's values
PlannerTransportSchema = z.object({
  from: Key, to: Key, mode: z.string().max(20),            // known: train | truck | drone | depot
  itemClassName: Name.nullable(), itemName: Name.nullable(), itemFrom: z.string().max(20).optional(),
  ratePerMinute: z.number().finite().min(0).nullable(), rate: z.enum(["measured", "estimated", "unknown"]),
  carriers: z.number().int().min(0), routeName: Name.nullable(), // game text, rendered as text
  flow: z.string().max(20).optional(), destination: z.string().max(20).optional(),
});
PlannerFactorySchema = z.object({
  key: Key, name: Name, designationId: z.uuid().nullable(),     // null = automatic
  products: z.array(PlannerRateSchema).max(PLANNER_MAX_RATES), sideProducts: z.array(Name).max(8),
  nodeKeys: z.array(Key).max(PLANNER_MAX_NODES), siteKeys: z.array(Key).max(PLANNER_MAX_SITES),
  machineCount: z.number().int().min(0), sharedNodeCount: z.number().int().min(0),
});
ProductionGraphSchema += {
  factories: z.array(PlannerFactorySchema).max(PLANNER_MAX_SITES).optional(),
  transports: z.array(PlannerTransportSchema).max(2_000).optional(),
  topologyHash: z.string().max(64).optional(),
  logistics: z.string().max(20).optional(),  // known: present | partial | notRead
};
// packages/shared/src/map.ts: the trainRoutes layer schema, its ingest request and its cap; later layers in their own PRs.
// Designations: their own contract PR (Decision 10, PR 9).
```

Fixtures: a two-factory component with a shared refinery, a remote farm joined by a train, an overflow to the sink and a
depot upload.

### Decision 10: build PRs (each from `main`, merged in order, not stacked), reshaping ADR-0053's six

ADR-0053 PR 1 merges into PR 1 here; its PRs 2 and 4 stand as PRs 2 and 4; its PR 3 loses the site change; its PRs 5 and
6 gain the factory level (PRs 7 and 8). Backend, adapter and agent PRs belong to the backend session; frontend PRs to the
frontend session; the core mod's layers to the mod session in its own repository.

| # | PR | Files | Proof |
| --- | --- | --- | --- |
| 1 | Contract | `packages/shared/src/productionGraph.ts`, `map.ts` (`trainRoutes`), fixtures | Old and new responses parse; unknown `mode`, `role`, `destination` values parse |
| 2 | Resource node class (ADR-0053 PR 2) | `packages/game-adapter/src/map/resourceNodesMapper.ts` | Against the captured response |
| 3 | Flows, trees, destinations (ADR-0053 PR 3 without its Decision 2) | `telemetry/services/productionGraph.ts` | ADR-0053's cases, plus each destination of Decision 3; `test-hunter` |
| 4 | Items (ADR-0053 PR 4) | the same, the route | Null-item edge count on the owner's save before and after, in the PR |
| 5 | `trainRoutes` layer | `packages/game-adapter/src/map/trainRoutesMapper.ts`, `rawSchemas.ts`, `agent/src/worldReader.ts`, `map/services/localWorldPoller.ts`, ingest | Mapper tests on the 2026-10-21 captures (trailing-space names, duplicate names); hash-unchanged writes nothing |
| 6a | Transport edges | `telemetry/services/logisticsEdges.ts` (pure), the route reads `trainRoutes` through `map/index.ts` | Train A to B with the item; two trains on one route make one edge with `carriers: 2`; duplicate name makes a note; the depot node; `test-hunter` |
| 6b | Factory reduction | `telemetry/services/factoryReduction.ts` (pure), called from `productionGraph.ts` | The worked example; seeds merge and split; ties; small-factory fold; a loop; post-dominators; byte-identical output on shuffled input; the 10x bound; topology hash stable across rate-only changes; `test-hunter` |
| 7 | Hierarchy and text form (ADR-0053 PR 5 + factories) | `frontend/src/planner/graph/hierarchy.ts`, `plannerText.ts`, per-factory tables, `src/demo/` | Pure tests; fallback to sites when `factories` is absent; scenarios; `ui-reviewer`, `test-hunter` |
| 8 | Canvas (ADR-0053 PR 6 + factories) | `SiteGraph.tsx`, `layoutSite.ts`, new `transportGlyphs.tsx`, `plannerPrefs.ts` (localStorage) | Factory overview, drill-down, collapse upstream, storage toggle, transport icons, motion toggle under reduced motion, layout memo by topology hash, e2e and axe, CSP gate; `ui-reviewer`, `test-hunter` |
| 9 | Designations, backend | contract PR first (`packages/shared/src/plannerDesignations.ts`), then migration `map.factory_designations`, `map/repositories/`, `map/routes/`, purge list, reduction honours them | Overlap 409, read-time drift, unmatched, non-member 404, member read-only; `security-reviewer`, `test-hunter` |
| 10 | Designations, UI | lasso, checkbox selection, "Reason factories for me" with "Keep" | e2e for lasso and keyboard path; `ui-reviewer` |
| 11 | `storageContents` layer and its item source | adapter mapper, both readers, `productionGraph.ts` (`itemFrom: "inventory"`) | After the `getStorageInv` capture: null-item edges on the owner's save before and after |
| 12 | `droneRoutes`, then `truckRoutes` (one PR each) | adapter mappers with lenient raw schemas, both readers, `logisticsEdges.ts` | Synthetic fixtures from the docs fields, marked; the game's class and property names cited in `raw-sources/` first; checked on the test install when a save there has them |

The Planner is live (#629). PRs 3 to 6b add fields the frontend ignores; the factory overview appears with PR 8.

## Consequences

- A factory is what the player means by one: everything that ends up in its product, wherever it stands, with shared
  suppliers shown as shared.
- Transport becomes visible as edges with a mode, without reading any rate the game does not offer.
- Rates stay honest: measured at machines, estimated on edges; shares are by design rate, which is stable but says what
  a line is built for, not what it carries this minute.
- One new table of player-authored configuration; nothing new holds game ids.
- Site names and the site overview stop being the planner's top level; ADR-0050 Decision 8's `map.site_names` is not built.

## Revisit when

- A factory's attribution surprises the owner on his save: tune the 0.95 shared threshold or the small-factory fold.
- Station stop filters appear in a capture: use them instead of inventories for train items.
- A request passes 50 ms: the one-entry memo per server keyed by the topology hash.
- The owner asks for build targets: recipe catalogue and LP (Decision 8).
- Building ids prove stable across restarts: ids may become a second key for designations (positions stay first).

## Questions for the owner

Answered 2026-10-24: 1 yes (a designation claims the farms feeding it by share), 2 yes (factories replace sites as
the first view), 3 option C (above), 4 yes (a session takes the trimmed `getStorageInv` and the `getFactory` pair
read-only; the mod session builds the drone and truck test save on its own test install), 5 System, 6 owner and
admin only.

1. **Designated factory and remote upstream:** a designated factory also claims the far farms that feed it by share
   (mode `core`, recommended, matches the Modular Frame example), or only exactly the machines you drew around?
2. **Top level:** factories replace the site overview as the Planner's first view (recommended), sites kept as a location
   label and for the map?
3. **Small factories:** fold a factory under 4 machines into the one it shares the most with, as a side product
   (recommended), or always keep every final product separate?
4. **Captures:** may a session take one trimmed read-only `getStorageInv` capture on your save, and one `getFactory`
   before and after a server restart (to settle whether building ids are stable)? Drones and trucks are designed from
   game and FRM names (your answer); may the mod session build a test save with one drone pair and one truck route on
   its separate test install to check them?
5. **Motion default:** "System" (on unless your OS asks for reduced motion, recommended) or off until you turn it on?
6. **Who designates:** owner and admin only (recommended), or any member?

## Owner answers already given (2026-10-24, relayed by the coordinator)

- **Recycler:** "Recycler is just awesome sink i think". The sink is the recycler and excess terminal (Decision 3). This
  also answers ADR-0053 Question 1: `TERMINAL_RECIPES` stays empty.
- **Drones and trucks:** no save has them; infer from the game's own class and property names, marked
  `[NEEDS VERIFICATION]` (Decision 1). Trains are checked on the owner's save.
- **Ground truth:** no hand-labelled factories; validation is by invariants and the measured statistics (Decision 4).

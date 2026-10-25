# ADR-0050: Production planner, the whole factory as a graph of machine groups

Status: **accepted** (owner, 2026-10-21; answers at the end; proposed by the architect the same day). Issue #588. Builds on
ADR-0048 and its accepted amendment (the `conveyors` world layer and the finder's connection graph) and ADR-0038 (the
10-minute world tier). Paths are under `backend/src/modules/` unless they start with a top-level directory. Amended by
ADR-0053 and by ADR-0055 (Decision 6's logistics edges and Decision 8's player-named sites, proposed).

## Context

The owner's idea (2026-10-21, #588): reconstruct the whole factory as a production graph (miner, smelter, constructors,
train, ..., output), laid out like Satisfactory Calculator's production planner. Two additions the same day: say which
graph algorithms are worth building on this data, and handle **several sites in one save** (an iron hub here, an oil
site there, linked by trains, drones or belts).

### What the code and data have

| Need | Evidence | Verdict |
| --- | --- | --- |
| Which building feeds which | The `conveyors` layer: one edge per belt, lift or pipe, `from`/`to` ids and kinds, tier capacity (`packages/shared/src/map.ts:143-162`); belts and lifts oriented end 0 to end 1, pipes not (ADR-0048 amendment, New evidence rows 4-5) | **Present**, every 10 min |
| A shared graph builder | The finder's `buildGraph` (`telemetry/services/bottleneckFinder.ts:238-331`): edges in id order, a union-find joining a conveyor's end to the matching end of the conveyor it names (`:250-285`), the first real kind names a node (`:298-304`), a pipe is two arcs (`:316`), open ends register their machine (`:318-322`). Private to the finder today | **Present**, needs extracting (Decision 1) |
| Junctions | Splitters, mergers, junctions and belt joins are uncapped pass-throughs; machine, storage, station, extractor, consumer and `other` are terminals (`bottleneckFinder.ts:41-48`, the region walk `:392-419`) | **Present** |
| Item per conveyor | **Not computed by the finder.** It works per (machine, ingredient): producers and consumers by item `className` (`:365-372`), a solid-or-fluid filter on arcs (`:333-341`), then a walk over the machine's upstream region. No conveyor ever gets an item | **Missing**, new logic (Decision 2) |
| Per-machine recipe and rates | `recipe` (`packages/shared/src/factory.ts:47`), `production` and `ingredients` with `currentPerMinute` and `maxPerMinute`, clock included (`:4-30`, `:67-76`), `state` (`:77-85`), `location` in metres (`:86-91`) | **Present** |
| Factory ids equal `ConnectedTo` strings | 332 of 340 `getFactory` buildings appear as conveyor ends in the same minute (ADR-0048 amendment, New evidence row 2; the belts capture `raw-sources/captured-responses/frm-getBelts-2026-10-21-connections-trimmed.json`). Both use the `<Class>_<number>` form (that capture: `Build_MinerMk1_C_2147011597`). The finder's own tests use synthetic ids (`bottleneckFinder.test.ts`), so the capture, not a test, is the proof | **Present** |
| Miners, pumps, storage, stations, generators, the sink | Ends only: "none is in `getFactory`" (ADR-0048 amendment, New evidence row 3). `getExtractor` is never captured (ADR-0048, What the data has). Generator and sink demand is not in the factory snapshot (same table) | **Nodes without item or rate** |
| Stale connections | The finder counts recipe machines no conveyor names (`bottleneckFinder.ts:380-386`) and says so (`beltData: "stale"`, `:844-845`); `CONNECTIONS_REFRESH_MINUTES = 10` (`:28`) | **Present**, reuse |
| Ids after a rebuild | G-B1: a rebuilt belt gets a new id; join by id only within one read (ADR-0048 amendment, G-check results; `raw-sources/frm-conveyor-gchecks-2026-10-21.md`). Factory id stability across restarts is `[NEEDS VERIFICATION]` (`factory.ts:42-44`) | Nothing keyed by id may be stored |
| A route to copy | `telemetry/routes/bottlenecks.ts`: reads the factory overview (`:52`) and the stored layer (`:25-35`, mapping skip and truncation to `unsupported`/`tooLarge`), runs a pure function, `sendValidated` with the snapshot envelope (`:54-56`). Telemetry may import `map` (`backend/src/architecture.test.ts:34`) | **Pattern** |
| Train logistics | Captures exist, from FRM 1.5.3 (2026-09-27): `getTrainStation` (2 stations; each `CargoInventory` lists platforms with `ID`, `LoadingMode` "Loading"/"Unloading", `Inventory`, plus station `TransferRate`, `InflowRate`, `OutflowRate`) and `getTrains` (`TimeTable` of `StationName` strings, wagons with `Inventory`) (`raw-sources/captured-responses/frm-getTrainStation-2026-09-27-full.json`, `frm-getTrains-2026-09-27-full.json`). Small: 4.4 KB and 1.4 KB, not game-thread (`wiki/frm-endpoint-volumes.md:25-27`; `raw-sources/frm-read-api.md`, Stations and Vehicles rows) | **Partly present**, see Decision 6 |
| Drones and trucks | `getDrone` and `getVehicles` captures are empty (`frm-getDrone-2026-09-27-empty.json`, `frm-getVehicles-2026-09-27-empty.json`); `getDroneStation`, `getTruckStation`, `getVehiclePaths` not captured, waiting on the owner (`wiki/frm-endpoint-volumes.md:74`) | **Missing** `[NEEDS VERIFICATION]` |

### Size reference

The owner's save: 340 factory buildings and about 2,400 conveyor edges, 647 KB uncompressed and 49 KB gzip as the
`conveyors` projection (ADR-0048 amendment, Decision 2). The finder's generated 10x factory (3,380 buildings, about 6,400
edges) runs in about 50 ms on the dev PC (`bottleneckFinder.test.ts:465-496`). The frontend's CSP is
`script-src 'self'` with no `unsafe-eval` and no `worker-src` (`frontend/public/_headers:6`); `e2e/` fails on any CSP
violation (`frontend/CLAUDE.md`, Tests).

## Decision

### Decision 1: the backend builds the graph from data it already has; the browser only lays it out

- **A new endpoint**, `GET /api/servers/:serverId/production-graph`, member-guarded like every `/api/servers/:serverId`
  route, built exactly like the bottlenecks route: the latest factory overview plus the stored `conveyors` row through
  `map/index.ts`, a pure function, the snapshot envelope. Without a database, 503 (as `bottlenecks.ts:51`).
- **Why not the frontend:** it would need the whole 647 KB layer plus every building on the wire, and a second copy of
  the union-find and junction rules. The backend already holds both inputs and the code; the response is the coarse
  graph (a few hundred groups, Decision 3's budget).
- **Extract, don't duplicate.** `buildGraph`, its `Graph`/`Arc` types, `TERMINAL_KINDS` and the region walk move to a new
  pure module `telemetry/services/connectionGraph.ts`; the finder imports it. Dinic, verdicts and ranking stay in the
  finder: the planner does not run max-flow (Graph algorithms, below). The extraction is its own PR, proven by the
  finder's tests passing unchanged.
- **Grouping (graph coarsening):** a **group** is the machines with the same building `className` and `recipe` whose
  inputs come from the same pass-through component (the splitters, mergers and joined belts between them and their
  suppliers). That is the manifold: "8x Constructor, Iron Plate". Pass-through components are collapsed into the edges
  between groups. Storage, stations, extractors and consumers stay as their own nodes, grouped the same way by class and
  the group they feed. A machine no conveyor names goes in an **unconnected** bucket and the response says
  `beltData: "stale"` (reusing `bottleneckFinder.ts:380-386`).
- **Stable keys without stored ids.** A group's `key` is `class|recipe|x|y` from its centroid snapped to a 50 m grid,
  plus an ordinal when two collide (ordered by the lowest member id). It is rebuilt every read and used only for UI state
  inside a session (selection, expanded group). Nothing stores it; sites (Decision 8) anchor by position.
- **Contract sketch** (its own PR in `packages/shared/src/productionGraph.ts`, additive, ADR-0007):

```ts
PlannerRateSchema = { className, name, unit /* as ProductionRate */, currentPerMinute, maxPerMinute };
PlannerNodeSchema = {
  key: string,                       // see "stable keys"; valid for one response
  kind: "machines" | "extractor" | "storage" | "station" | "consumer" | "other",
  className: string, name: string, recipe: string | null,
  count: number, machineIds: string[], // ids of this snapshot, for the bottleneck link and the group panel
  stateCounts: Record<string, number>,
  products: PlannerRate[], ingredients: PlannerRate[],   // sums over the group; empty for ends without data
  at: { x: number, y: number },      // centroid, whole metres
  siteKey: string, loop: boolean,    // Decision 8; part of a cycle (SCC)
};
PlannerEdgeSchema = {
  from: string, to: string,          // node keys
  kind: "belt" | "pipe",             // a lift counts as belt
  itemClassName: string | null, itemName: string | null,  // null = could not be inferred
  ratePerMinute: number | null,      // Decision 2
  rate: "measured" | "estimated" | "unknown",
  mixed: boolean,                    // the pass-through component carries more than one item
  capacityPerMinute: number | null,  // only for an unbranched chain; else null
  conveyorCount: number,
};
ProductionGraphSchema = { nodes, edges, sites, unconnectedMachineIds,
  beltData: "present" | "stale" | "unsupported" | "tooLarge", connectionsRefreshMinutes: 10, notes };
```

  Caps: nodes 5,000, edges 20,000, `machineIds` per node 1,000; every name is game-server text, rendered as text only
  (as the map's tooltips, `frontend/CLAUDE.md`, Map).

### Decision 2: item per edge and rate, and saying what is not known

- **Item:** for a group-to-group edge through a pass-through component, the item is the intersection of the source's
  products and the destination's ingredients, filtered by conveyor kind (belts solid, pipes fluid, the finder's
  `usable`, `bottleneckFinder.ts:337-341`). One item: that item. None: no edge, counted in a note ("N links carry
  items their destination does not use: a mixed belt, a filter or overflow"). An extractor's item is inferred
  downstream: the ingredient its destinations need that no producer group upstream of them supplies. Ambiguous stays
  `null`.
- **Mixed belts:** a pass-through component reached by producers of two or more solid items is `mixed`. Its edges keep
  their inferred items but are drawn as mixed, and their rates are `estimated`.
- **Rates (flow balance):** consumption and production are measured per machine (`currentPerMinute`). For item X: when
  a destination group has exactly one source group for X, the edge rate is the destination's measured consumption of X
  (`rate: "measured"`). With several sources, the destination's consumption is shared out in proportion to the sources'
  measured output (`"estimated"`). The split after a splitter between branches, sushi belts, smart-splitter filters,
  overflow into storage or the sink, and what generators and the sink take, are **unknowable** from this data; those
  edges are `"unknown"` or `"estimated"`, never presented as measured.
- **Capacity:** shown only for an unbranched chain (the slowest tier on it). Through a manifold the meaningful cap is a
  min cut, which is the finder's job: the planner links to the finding instead of recomputing it.
- **Shown as:** measured rates plain; estimated with "about" and a dashed edge; unknown with no number; a group's node
  shows actual over max per product. The legend and the text form say the same words.

### Decision 3: layout with dagre, in the lazy chunk, per site

| Library | Size (min / gzip) | CSP fit | Licence | Note |
| --- | --- | --- | --- | --- |
| **`@dagrejs/dagre` 3.1.1** | 49 KB / 17 KB (`dist/dagre.min.js`, graphlib bundled; measured from the npm tarball 2026-10-21) | No `eval` or `new Function` in the build (grep of the tarball) | MIT | Sugiyama: cycle removal (`acyclicer`), ranking (`ranker`), crossing reduction, coordinates; `rankdir: "LR"` gives sources left, outputs right |
| `elkjs` 0.12.0 | 1.61 MB / 470 KB (`lib/elk.bundled.js`, measured from the tarball) | No `eval` in the build; spawns a worker or a fake one | EPL-2.0 OR GPL-3.0-or-later (npm registry) | Better layered layout with ports, 27 times dagre's gzip size, and a licence question for an AGPL-3.0-only repo |
| `d3-dag` 1.2.2 | 136 KB / 42 KB (bundlephobia, 2026-10-21) | not checked | MIT | DAG only: our graph has loops (Graph algorithms, SCC) |
| `@xyflow/react` 12.12.0 | 188 KB / 60 KB (bundlephobia, 2026-10-21) | not checked | MIT | A node editor (pan, zoom, DOM nodes); no layout of its own. Not needed for a read-only view |

**dagre**, drawn as SVG by our own component with token classes, pan and zoom by pointer, wheel, pinch and buttons. It
loads in the planner's lazy chunk only, as `MapCanvas` does (`frontend/src/map/MapPanel.tsx:25-28`). Budget: the chunk
under 100 KB gzip, checked in `e2e/build-output.spec.ts` (dagre not in the entry chunk).

- **Where layout runs: the main thread, per site.** The overview lays out only the sites (a handful of nodes); a site's
  graph is laid out when it is opened, so one layout covers one site, not the world. On the owner's save one site is at
  most the 340 machines' groups [estimate: under 150 nodes]. **Worker: not yet.** Trigger: a layout over 100 ms on the
  demo's largest site or a long-task warning in e2e. The cheap step now: layout behind one async function
  `layoutSite(graph): Promise<Positions>`, so moving it into a module worker (a same-origin file Vite emits, which
  `default-src 'self'` allows; the e2e CSP gate proves it) changes no caller.
- **Not precomputed on the backend:** positions depend on filters and on which site is open, and would put a layout
  library into the backend bundle for no gain.

### Decision 4: interaction and its place in the app

- **A new "Planner" tab** after Factory (`frontend/src/shell/Shell.tsx:253-254`), lazily loaded. It opens on the
  **site overview** (Decision 8); a site opens its graph.
- **In a site's graph:** zoom and pan; filter by item (highlights the groups and edges that carry it, upstream and
  downstream: a reachability walk on the coarse graph); click a group for a side panel listing its machines (name,
  state, clock, actual over max), read from the existing `factory` query by `machineIds`; a "bottleneck" badge on a group
  whose machine has a finding in the existing `bottlenecks` query (joined by `buildingId`, no contract change), with a
  link to that finding on the Factory page.
- **Text alternative, always:** a table per site (group, count, recipe, actual over max out, state counts) and an edges
  table (from, to, item, rate with its `measured`/`about`/`unknown` word). The SVG has `role="img"` and a summary label.
  On a narrow screen (390 px) the tables are the default, the graph one tap away.
- **Loading and states:** the shell's `Page` and `<Loadable>` skeleton (`frontend/CLAUDE.md`, Loading); a note for each
  `beltData` mode, worded like the finder's; an empty factory; a scenario for each in `src/test/scenarios.ts` and
  `e2e/states.spec.ts`.
- **Demo:** a made-up multi-site world with a loop, a mixed belt and an estimated edge, in `src/demo/` (never the test
  fixtures, `frontend/CLAUDE.md`, Demo build).
- **Map:** a "show on map" link from a site or group is a later, separate PR; it needs a map focus parameter that does
  not exist yet.

### Decision 5: no extra game-server reads; cache only when measured

- The graph comes from the stored `conveyors` row (read at most every 10 min, ADR-0038) and the factory overview the
  bottlenecks route already uses. On an agent server that is the stored snapshot. On a local server
  `getFactoryOverview` is a live `getFactory` read (`telemetry/services/productionService.ts:37-43`,
  `packages/game-adapter/src/satisfactoryServerAdapter.ts:173-174`), the same read the Factory page polls every 30 s
  (`frontend/src/api/queries.ts:30`). The planner refetches at that interval, only while its tab is open.
- **CPU:** linear passes over the connection graph plus grouping [estimate: a few ms on the owner's save, well under the
  finder's 50 ms at 10x]. PR 3 adds a generated-10x test with a generous bound, like `bottleneckFinder.test.ts:489-496`.
- **Cache: not yet.** Trigger: a request over 50 ms (ADR-0048's existing rule) or a second concurrent viewer on a local
  server. Then: memoise per (server, factory `observedAt`, conveyors `hash`) (`map/repositories/worldLayerRepository.ts:20-27`
  has the hash) and coalesce the local `getFactory` read.

### Decision 6: logistics edges are phase 3, trains first, each behind a capture

- **Trains:** a station's loading platform at one site and an unloading platform at another are joined by a train
  whose timetable names both stations. The edge's item comes from the platforms' or wagons' `Inventory`. Gate, before
  any code: a fresh read-only capture of `getTrainStation` and `getTrains` on FRM 1.5.4 into `raw-sources/`, checking
  that a platform's `ID` equals the `ConnectedTo` id of the belts at it, and that timetable `StationName`s resolve to one
  station each (names are player text and can repeat; the capture's station name has a trailing space). The meaning of
  `TransferRate`, `InflowRate` and `OutflowRate` is `[NEEDS VERIFICATION]` (all 0 or unexplained in the capture), so
  train edges carry an item and no rate until a capture explains one. Transport: a `trains` world layer on the
  10-minute tier (both endpoints are small and not game-thread).
- **Drones and trucks:** `[NEEDS VERIFICATION]` for every field; gated on the owner building one and capturing
  `getDroneStation`, `getDrone`, `getTruckStation` and `getVehicles` (CAP-4).
- Until then a station is a node in its site with a "train link not read yet" note.

### Decision 7: build tasks (each one PR from `main`, no stacked PRs; nothing user-visible before PR 5)

1. **Extract the connection graph** (backend session, `telemetry/services/connectionGraph.ts`): move `buildGraph`, its
   types, the kinds and the region walk; add weakly connected components and pass-through components with their own
   tests. Proof: the finder's tests pass unchanged. Reviewer: `test-hunter` on the new functions.
2. **Contract** (backend session, `packages/shared/src/productionGraph.ts`, the `endpoints` entry, fixtures): Decision 1's
   sketch with caps. Schema tests and typecheck.
3. **Service** (backend session, `telemetry/services/productionGraph.ts`): grouping, item inference, flow balance, SCC
   loops, sites (Decision 8), as a pure function of (buildings, edges). Tests: a manifold groups, a mixed belt, an
   extractor's inferred item, measured versus estimated rates, a loop, two sites, a stale machine, the 10x bound.
   Reviewer: `test-hunter`.
4. **Route** (backend session, `telemetry/routes/productionGraph.ts`): copy of the bottlenecks route, Supertest for each
   `beltData` mode, 503 without a database, a non-member 404. Reviewer: `test-hunter`.
5. **Planner page, text form** (frontend session): the tab, the query, the site overview and per-site tables, every
   state, demo data and handler, scenarios and e2e. Reviewers: `ui-reviewer`, `test-hunter`.
6. **Graph view** (frontend session): dagre plus the SVG canvas in the lazy chunk, pan and zoom, item filter, group
   panel, bottleneck badge, the chunk budget in `e2e/build-output.spec.ts`. Reviewers: `ui-reviewer`, `test-hunter`.

Phase 2 (owner's call, Questions 3): site names (Decision 8). Phase 3: Decision 6, starting with its capture.

## Graph algorithms: what is worth building on this data

The data's limits decide this: capacities are rated maxima, not flow (G-B2); conveyor ids are valid for one read; the
item on a conveyor is inferred from recipes. Sizes: the owner's connection graph has about 2,400 arcs and the coarse
group graph a few hundred nodes [estimate]; 10x is about 24,000 arcs.

| Algorithm | Useful here? | What the player sees | Cost (owner's save; 10x) | Reuses | Verdict |
| --- | --- | --- | --- | --- | --- |
| Max-flow / min-cut | Yes, already | "This Mk.1 belt caps 12 consumers" | The finder's Dinic, about 50 ms at 10x (`bottleneckFinder.test.ts:495`) | The finder | **Link, don't rerun**: the planner shows the finder's results on groups |
| Dijkstra, shortest or widest path | No | A single "best route" for an item. With maxima instead of flow the widest path is never more than the max-flow, so it answers a weaker form of the finder's question; "the route an item takes" is the set of reachable conveyors, not one path | O(E log V) per source; small | none | **Not built.** A reachability walk (below) answers "where does this go" |
| A* | No | Nothing: there is no geometric goal to search towards | n/a | n/a | **Not built** |
| Reachability (BFS up and down) | Yes | Item filter and "everything this group feeds or depends on" highlight | O(V+E) on the coarse graph, under a millisecond | the region walk (`bottleneckFinder.ts:392-419`) | **Phase 1**, frontend on the coarse graph |
| Topological order and longest path | Yes, through dagre | Columns from raw resources to final products; a site's default name from its most downstream product | Linear on the SCC condensation | dagre's ranker does the layout part | **Phase 1**, inside dagre and for the default site name |
| Strongly connected components (loops) | Yes | "Loop" badge on recycled rubber or plastic, packaged fluids, a belt looped through mergers; the layout reverses one edge per loop and draws it as a feedback edge | Tarjan, linear; iterative, because belt chains can be tens of thousands of segments deep (`bottleneckFinder.ts:171-172`) | new | **Phase 1**, on the coarse graph |
| Weakly connected components | Yes | The separate production clusters, the base of sites | Union-find, linear | the union-find in `buildGraph` (`bottleneckFinder.ts:250-269`) | **Phase 1** (Decision 8) |
| Dominator trees | Maybe | "If this smelter line stops, these 40 machines lose their only supply": single points of failure | Near linear on the coarse graph | new | **Not yet.** Trigger: the owner asks "what breaks if X stops", or the reachability highlight proves too coarse. Cheap step: the coarse graph already has the shape it needs |
| Flow balance | Yes, core | Rates on edges, measured or estimated (Decision 2) | Linear | new | **Phase 1** |
| Linear programming (ideal counts) | Not for this view | "Build 3 more smelters for 300 Iron Ingot/min": a planner that proposes, not one that shows. It needs a full recipe catalogue (alternate recipes); the backend has only each machine's configured recipe rates | A small LP is cheap; the catalogue and its upkeep are the cost | none | **Not yet.** Trigger: the owner wants targets ("what do I build for X/min"). Cheap step: per-group max rates are already in the contract, so "N machines of this recipe for target T" is arithmetic, not LP |
| Graph coarsening, clustering | Yes, core | "8x Constructor, Iron Plate" instead of 8 boxes and 40 splitters | Linear | pass-through components from PR 1 | **Phase 1** (Decision 1) |
| Sugiyama layered layout | Yes | The calculator-like left-to-right picture | dagre on one site's groups [estimate: tens of ms under 150 nodes] | dagre | **Phase 1** (Decision 3) |

The set to build: coarsening, flow balance, WCC, SCC, reachability and Sugiyama through dagre. All linear or close to
it, all on data present today.

## Several sites in one save

### Decision 8: sites are computed (components merged by distance); names are stored later, anchored by position

- **Find them:** weakly connected components of the connection graph are the atoms. Trains, drones and trucks are not
  conveyors, so a component already ends at a station platform. Components then merge when their machines' bounding
  boxes are within a distance **D** (single-linkage, by union-find, deterministic), because one base often holds many
  belt-independent lines. D starts at 150 m [estimate; PR 3 logs component and site counts on the owner's save, and the
  value is tuned there]. Rejected: purely spatial clustering (it splits a long belt-linked outpost and needs positions
  for every end, which only machines have, `factory.ts:86-91`; conveyors carry `at` only for end 0, `map.ts:158`), and
  splitting at stations alone (it is what WCC already does).
- **Name them, by default:** the most downstream product of the site ("Computer site"), else "Site near (x, y)". Computed
  every read; `siteKey` is the site's snapped centroid, for UI state only.
- **Show them:** the Planner opens on a site overview: one card or node per site with machine count, state counts, top
  outputs (actual over max) and its bottleneck count; once trains are read (Decision 6) the links between sites with
  their items. A site opens its own graph (Decision 3: one layout per site).
- **Bottleneck finder:** findings grouped per site in the planner by joining `buildingId` to a group's `machineIds`; no
  change to the finder or its contract. Grouping findings on the Factory page is a later choice.
- **Map:** sites as a map layer (an outline and a label) through the existing `MapLayer` contract
  (`frontend/CLAUDE.md`, Map) is a later PR, after phase 1 shows whether the computed sites match what the player sees.
- **Player-named sites (phase 2, owner's call):** new per-server state, the first the planner stores.
  - Table `map.site_names (server_id uuid REFERENCES servers.servers ON DELETE CASCADE, id uuid, name text 1..64,
    anchor_x_m int, anchor_y_m int, updated_at)`; the `map` schema, beside `map.world_layers`
    (`backend/migrations/1791158400000_map_world_layers.sql:26-36`). An expand-only migration (ADR-0049).
  - **Anchored by position, never by id** (G-B1; `factory.ts:42-44`): a computed site takes the stored name whose anchor
    lies inside its bounding box, nearest the centroid on a tie; an anchor no site contains is listed as "unmatched" to
    the owner, not deleted silently.
  - Write: owner and admin only, through the existing guard (`servers/serverAccess.ts:49-50`, `:106`); read: any member.
    No user id stored (an audit event instead), so ADR-0047's account deletion needs nothing new. Added to the removal
    purge list (`servers/repositories/serverRepository.ts:212-219`), which says every table referencing
    `servers.servers` must be there.
  - Names are player text: length-capped, rendered as text only. `security-reviewer` on that PR.
- **Computed versus stored:** components, sites, default names, groups, rates and keys are computed every read. Only the
  owner's names and their anchors are stored. A manual merge or split of sites is **not yet**; trigger: the owner reports
  that D groups his bases wrongly and no value fixes it.

## Consequences

- One graph builder serves the finder and the planner; a fix to junction handling lands in both.
- The planner is honest about rates: measured where one source feeds a group, estimated or unknown elsewhere, in the
  picture and in the tables.
- One small dependency (dagre, MIT, 17 KB gzip) in a lazy chunk; no new game-server read; no new table in phase 1.
- Group and site keys are positional and valid for one response, so a rebuilt line keeps its place but not its
  selection when it moves more than one grid cell.
- Generators, the sink and extractors show no rates until follow-up 5 of ADR-0048 (extractors) or a generator read
  lands; sites with power plants look like they consume nothing.

## Revisit when

- A site's layout passes 100 ms: move `layoutSite` into a worker (Decision 3).
- A request passes 50 ms, or a local server has two viewers: cache and coalesce (Decision 5).
- The owner asks what breaks if a machine stops: dominator trees.
- The owner wants build targets: a recipe catalogue and LP.
- D groups bases wrongly: manual merge or split.
- The 1.5.4 train capture passes: Decision 6 phase 3.
- ELK's better routing becomes worth 470 KB gzip, after the licence question is settled.

## Questions for the owner

1. **Where it lives:** a new "Planner" tab (recommended; a graph needs the full width), or a section on the Factory page?
2. **When users see it:** ship PR 5's site overview and tables visible on their own (recommended: useful without the
   picture), or keep everything hidden until the graph (PR 6), as ADR-0048 did?
3. **Player-named sites (phase 2):** build them after phase 1 (new stored state, owner and admin can rename), or keep
   only the computed names until you have used them?
4. **Train links:** may the mod or adapter session take a fresh read-only `getTrainStation` and `getTrains` capture on
   your live save (FRM 1.5.4), to open phase 3?

## Owner answers (2026-10-21)

1. **Placement:** a new **Planner** tab, lazy-loaded (as proposed).
2. **Release:** **hidden until the graph view lands.** PR 5's site overview and tables merge hidden (no tab link,
   like the bottleneck PRs 1-4), and PR 6 makes the whole Planner visible at once.
3. **Player-named sites:** **yes, phase 2**, as proposed: the `map.site_names` table, anchored by position and never by
   id, written by owners and admins, on the server-removal purge list, with security-reviewer.
4. **Train data:** **yes**. A session may take one read-only `getTrainStation` + `getTrains` capture from the owner's live
   save (FRM 1.5.4), trimmed before it goes into `docs-vault/raw-sources/` (a handful of records, no full payloads). It
   checks the phase 3 gate: platform ids equal belt end ids, and station names resolve uniquely.

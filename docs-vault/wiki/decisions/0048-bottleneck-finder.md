# ADR-0048: Bottleneck finder over the item graph, not the belt graph

Status: accepted with a change (owner, 2026-10-21): the feature waits for belt data. The item-level slice is not built
on its own; it ships together with the belt level once the mod claim below is verified. Issue #349.
Amendment (2026-10-21, **proposed**, for the owner's review): the first revisit trigger fired, FRM 1.5.4 names what both
ends of every belt, lift and pipe connect to, so the belt level is a go on FRM data and the mod claim is not needed. See
"Amendment (2026-10-21)" at the end; where it and the text above disagree, the amendment wins once accepted.

## Context

The owner asked (2026-09-27, issue #349) for a finder that walks from an underfed or backed-up machine to the root cause:
a resource node's extraction rate, a belt or pipe tier cap, a power-limited machine, or a missing input. On 2026-10-20:
"can we try for 349 and back off if it's too complicated". This ADR is the feasibility study. Paths are under
`backend/src/modules/` unless they start with a top-level directory.

### What the data has

| Need | Source | Verdict |
| --- | --- | --- |
| Which machine feeds which, through which belt or pipe | `getBelts`: per segment `ID`, `location0`/`location1` (start and end), `Connected0`/`Connected1` booleans, `Length`, `ItemsPerMinute` ("Speed of the Belt") (`raw-sources/frm-getBelts.md` E2; capture `captured-responses/frm-getBelts-2026-09-27-trimmed.json`). `getPipes`: the same, with `Speed` (`frm-getPipes-2026-09-27-trimmed.json`) | **Missing.** `Connected0/1` say *whether* an end is attached, never *to what*. No field names the building, port or other segment at either end |
| Port positions on machines, to infer links from belt endpoints | `getFactory`: `location` (centre), `rotation`, `BoundingBox` only (`frm-getFactory.md` E2; the running capture) | **Missing.** No port list or offsets. Inferring "this belt end is that machine's input 2" needs a per-class port table that no file in `raw-sources/` has [NEEDS VERIFICATION] |
| Splitters, mergers, lifts, storage between machines | The FRM read index (`frm-read-api.md` E2) lists no splitter, merger or lift endpoint; E1 says "Some endpoints are new and not yet documented" | **Missing** [NEEDS VERIFICATION: an undocumented endpoint]. Without them any belt chain through a splitter or merger breaks, and almost every factory has them |
| Belt or pipe flow, items on a belt, how full it is | `frm-getBelts.md` header: "None of the table's rows describes items on the belt or how full it is" | **Missing**, so a saturated edge cannot be observed, only a tier cap |
| Belt tier caps | `ItemsPerMinute` 60/120/270/480 seen in the full capture (capture header) | Present, but useless without the topology |
| Per-machine recipe rates: what each machine makes and needs, actual vs max, clock included | `getFactory` `production[]` (`CurrentProd`, `MaxProd`) and `ingredients[]` (`CurrentConsumed`, `MaxConsumed`) (`frm-getFactory.md` E3, E4); already in the contract as `production` and `ingredients` (`packages/shared/src/factory.ts:67-76`) and the agent snapshot (`packages/shared/src/agent.ts:102-103`); "MaxProd already includes clock speed" (running capture header) | **Present, today**, in both the local poller and the agent path |
| Machine power state | `circuitGroupId` -1 and a tripped fuse already classify as `unpowered` (`telemetry/services/classifyBuilding.ts:53-56`; `wiki/machine-states.md`) | **Present** |
| Underfed / backed-up per machine | `classifyBuilding.ts:64-77` (`backedUp`, `underfed` with `missingInput`) | **Present**, with one weakness below |
| Extractor (miner, pump) rates | `getExtractor` exists in the index, game thread Yes (`frm-read-api.md` E2); never captured, not in the snapshot. Whether `getFactory`'s 338 buildings include extractors is not recorded [NEEDS VERIFICATION] | **Missing today**, capturable |
| Generator and sink demand (coal, fuel, items sunk or stored) | Generators come from other endpoints (`frm-read-api.md` E2, Generators rows); storage from `getStorageInv` | **Not in the factory snapshot**; demand for those items is under-counted |

**`missingInput` is close to arbitrary.** FRM reports one `ConsPercent` for all of a machine's ingredients: the capture's
coated-canister assembler reads 9.41 for both Iron Plate and Copper Sheet, and the 160 % Stator assembler 24.7 for both
(running capture, entries 2 and 4). `lowestIngredient` (`classifyBuilding.ts:76`, `:90-94`) therefore returns the first
ingredient on a tie. The finder must not trust it.

### Size reference

The owner's tier-6 save: 338 factory buildings (running capture header), 1,987 belt segments in 3.27 MB and 156 pipes in
251 KB (the two capture headers). A factory read in contract form is about 440 bytes a building, about 100 KB for a real
factory (`agents/config.ts:11-12`).

## Decision

**Belt-level root cause (belt or pipe tier cap, a specific saturated edge, max-flow/min-cut): no-go on FRM data.** The
graph cannot be built: no connection identities, no port positions, no splitters or mergers, no flow. Positional
inference would need a hand-made port table per building class and would still break at every splitter and merger, so it
is not reliable enough to name a root cause. This part waits for a mod claim (below).

**Item-level root cause: go.** Every fact it needs is already in the factory snapshot, so it costs no new FRM read, no
contract change on the agent side and no snapshot bytes.

### The model

A bipartite directed graph built per request from one factory snapshot:
- **Machine nodes:** every building with a recipe, carrying its `state` (ADR-0027).
- **Item nodes:** every `className` that appears in a `production` or `ingredients` entry (at most the ~195 items of
  ADR-0015's catalog).
- **Edges:** machine -> item for each `production` entry (capacity `maxPerMinute`, actual `currentPerMinute`); item ->
  machine for each `ingredients` entry (demand `maxPerMinute`, actual `currentPerMinute`).
- **Per item:** `supplyMax` = sum of producers' `maxPerMinute`; `supplyNow` = sum of `currentPerMinute`; `demandMax` = sum
  of consumers' `maxPerMinute`. An item with no producer in the snapshot is a **source leaf** (ores, water, crude oil
  until extractors are read).

### The algorithm: an upstream walk with verdicts, not max-flow

From an underfed machine M, for **each** of its ingredients (not only `missingInput`), assign a verdict, then rank:

1. **`noProducer`**: no machine makes item X. If X is a raw resource, "X comes from extractors, which the dashboard does
   not read yet"; otherwise "nothing makes X" (the owner's "missing input").
2. **`deficit`**: `demandMax(X) > supplyMax(X)`: "X is made at most S/min and its consumers want D/min". This is the
   structural shortage; the walk continues into X's producers only to see if they are also short.
3. **`upstream`**: some producers of X are themselves `underfed`, `unpowered`, `paused` or `idle`: recurse into them
   (`unpowered` and `paused` are terminal verdicts: "producer P is unpowered").
4. **`logistics`**: supply is enough and X's producers are healthy or `backedUp`: "enough X is made, it isn't reaching M".
   That is the belt, pipe, routing or splitter case the data cannot locate. It is reported as such, honestly, and it is
   exactly what the belt-level follow-up would sharpen.

Rank per machine: `noProducer` > `deficit` > `upstream` (with its terminal) > `logistics`. **Backed up** is the mirror walk
downstream over output items: `noConsumer` (nothing in the snapshot consumes X; it may go to storage, a sink or a
generator, which the snapshot does not show), `surplus` (`supplyMax > demandMax`), `downstream` (consumers are underfed
on another input, recurse) and `logistics`.

**Cycles** (e.g. recycled plastic and rubber loops) need no SCC pass: the walk keeps a visited set of item nodes and
stops at one already seen (the cycle is reported as "loop through X"). Tarjan's SCCs become worth it only if a later
slice propagates *rates* in topological order; the slice below does not.

**Why not max-flow now.** Edmonds-Karp, O(V E^2), or Dinic, O(V^2 E), answer "which edges are on the min cut" only when
edge capacities are per connection. At item level the capacity of "X reaches M" is not observable (that is the
`logistics` case), and the aggregate capacity is a sum, so max-flow adds nothing a sum does not. It is the right tool for
the belt-level follow-up, where it would run on about 2,000 to 20,000 belt edges.

**Complexity.** Building the graph is O(B + R), B buildings and R rate entries (bounded by 16 per building, `agent.ts`
bounds). With item verdicts memoised, all underfed and backed-up machines together are one O(V + E) pass. At 338
buildings: V about 500, E about 1,500 to 2,000 (2 to 6 rates a building). At 10x (3,380): V about 3,600, E about 20,000.
Both are well under a millisecond to a few milliseconds in Node; the contract's own bound (20,000 buildings,
`agent.ts:75`) is still about 100,000 edges, a few tens of milliseconds.

**Deterministic** (ground rule 3): pure function of one snapshot; ties broken by item `className` then building `id`, no
randomness, no time, no LLM.

### Where it runs and what it costs

- A pure service `telemetry/services/bottleneckFinder.ts`, owned by the backend session, called by a new route in
  `telemetry/routes/` over the same snapshot `production.getFactoryOverview()` already serves
  (`telemetry/routes/factory.ts:16`). Computed on demand; no cache, no table, no worker.
- **No new data volume.** It reads the factory snapshot already polled locally and already pushed by the agent, so #514's
  budgets (`SNAPSHOT_MAX_BYTES` 5 MB, 4 MB a minute, `agents/config.ts:15`, `:32-38`) are unchanged, and the mod's snapshot
  needs nothing new.
- **Response size.** Top N (default 10, max 50), each with at most a depth-8 chain of short records: about 0.2 to 0.5 KB a
  finding, so under 15 KB at N 25, about 5 KB at the default.

### Contract sketch (its own PR, before the service; additive per ADR-0007)

```ts
// packages/shared/src/bottlenecks.ts
BottleneckStepSchema = z.object({
  kind: z.enum(["noProducer", "deficit", "upstream", "logistics", "unpowered", "paused", "idle", "loop",
                "noConsumer", "surplus", "downstream"]),   // parsed leniently on the frontend (unknown kind = generic text)
  itemClassName: z.string().optional(),
  itemName: z.string().optional(),
  buildingId: z.string().optional(),       // the producer or consumer this step points at
  supplyMaxPerMinute: z.number().min(0).optional(),
  demandMaxPerMinute: z.number().min(0).optional(),
  unit: z.enum(["items/min", "m3/min"]).nullable().optional(),   // ADR-0015
});
BottleneckSchema = z.object({
  buildingId: z.string(), buildingName: z.string(),
  state: z.enum(["underfed", "backedUp"]),
  rootCause: BottleneckStepSchema,           // the ranked terminal verdict
  chain: z.array(BottleneckStepSchema).max(8),
  text: z.string(),                          // one deterministic sentence built by the backend
});
BottlenecksSchema = z.object({ findings: z.array(BottleneckSchema).max(50), truncated: z.boolean() });
// GET /api/servers/:serverId/bottlenecks?limit=10   -> snapshotEnvelope(BottlenecksSchema)
```

Ranking of the top N: machines whose root cause is shared by the most underfed machines first (one `deficit` of Wire that
starves twelve assemblers outranks a single `logistics` case), then by lost output (`maxPerMinute - currentPerMinute` of
the machine's main product), then `buildingId`.

## Build tasks (each one PR, smallest first; no stacked PRs)

1. **Contract** (`packages/shared/`, backend session): `bottlenecks.ts` above, the `endpoints.bottlenecks` entry, a
   fixture. Verified by the shared package's schema tests and typecheck.
2. **Service** (`telemetry/services/bottleneckFinder.ts`, backend): the graph, the walk and the ranking as a pure
   function over `FactoryBuilding[]`. Tests from fixtures: each verdict, a cycle, ties, the capture-shaped buildings,
   and a 3,380-building generated factory finishing well inside a time bound. Then `test-hunter`.
3. **Route** (`telemetry/routes/bottlenecks.ts`, backend): server-scoped, session-guarded like `factory`, validated with
   `sendValidated`, a Supertest route test, `limit` validated (1 to 50).
4. **Frontend** (frontend session, one PR, `ui-reviewer`): a top-N "Bottlenecks" list and a "why" line on an underfed or
   backed-up machine, built on design tokens; unknown `kind` shows the `text` only.

Follow-ups, not in this slice, each needing the owner's go:

5. **Extractors** (data-adapter then backend): capture `getExtractor` into `raw-sources/` first (ADR-0038's rule), then
   read it at the ADR-0038 world cadence (game-thread endpoint) so source leaves become "node X yields N/min". A new
   snapshot part, so a contract PR and a #514 byte check.
6. **Per-ingredient buffer fill** (contract, additive): `ingredients[].bufferPercent` from `InputInventory` so the finder
   (and `missingInput`) can tell which input is actually short. About 15 bytes an ingredient, ~5 KB on this save.
7. **Belt level** (mod): see below.

## What the mod would need for the belt-level finder

A new `wiki/mod-claims.md` row, sourced at G0 and spiked at G2 before any design uses it (ADR-0039): "the mod can list,
for every factory and pipe connection component, the actor on the other end" so it can emit edges
`{fromBuildingId, fromPort, toBuildingId, toPort, beltId?, tierItemsPerMinute}` including splitters, mergers, lifts and
storage. No source in `raw-sources/` names the game classes for this yet [NEEDS VERIFICATION]. Volume: about 4,000 edges on
this save at ~60 bytes each, about 240 KB, sent only when its hash changes (ADR-0038's world rule). With that graph, the
`logistics` verdict becomes a Dinic min-cut over belt capacities naming the segment that caps the flow.

## Consequences

- Answers "why is this machine underfed" for the structural cases (nothing makes it, not enough is made, the producer is
  unpowered or starved itself) with data the dashboard already has, at no ingest cost.
- Does **not** name a belt or pipe. The `logistics` verdict says so plainly; it is the honest boundary of FRM data.
- Aggregation hides geography: two separate Wire lines count as one supply, so a local shortage beside a global surplus
  reads `logistics`, not `deficit`. Correct as far as it goes, and stated in the UI text.
- Demand from generators, storage and the sink is invisible, so `noConsumer` and `surplus` are worded as "nothing in the
  factory consumes it", never "nothing consumes it".
- Raw resources are leaves until task 5.

## Revisit when

- An undocumented FRM endpoint turns out to expose connections or splitters (check `frm-read-api.md` E1's note against
  FRM's newer docs): reopen the belt-level no-go without a mod.
- The mod claim above is verified: write the belt-level ADR (max-flow over the connection graph).
- Owner feedback says `logistics` dominates the findings on real saves: that is the evidence for task 7.
- A finder request is measured above ~50 ms on a real factory: cache the result per snapshot.

## Questions for the owner

1. Accept item-level root cause as #349's first slice, with belt and pipe caps explicitly deferred to the mod?
2. Default N for the top list (10 proposed) and where it lives (Overview card, or its own page)?
3. Follow-ups 5 (extractors) and 6 (buffer fill): queue them now, or wait for feedback on slice 1?
4. Open the belt-connection mod claim (G0 source search) now, or only after slice 1 has been used?

**Owner answers (2026-10-21):**
1. **No: wait for belt data.** Don't ship item-level root cause alone. Build the finder once the belt-connection
   claim is verified, so its first version can name belt and pipe caps too. The item-level model above stays the
   design for the item part.
2. **The Factory page, top 10:** a "Bottlenecks" section on the Factory page listing the 10 worst root causes.
3. **After feedback:** follow-ups 5 (extractors) and 6 (buffer fill) wait until the finder has been used.
4. **Now:** open the belt-connection mod claim and start its G0 source search in the mod session.

## Amendment (2026-10-21)

Status: **accepted** (owner, 2026-10-21; answers at the end of this amendment). Written because the first "Revisit when" trigger fired: FRM now
names the building at each end of a belt, lift and pipe. Captures, all read-only from the owner's live server on
2026-10-21 with FRM 1.5.4 (getModList), are under `raw-sources/captured-responses/`: the **belts capture**
`frm-getBelts-2026-10-21-connections-trimmed.json`, the **lifts capture** `frm-getLifts-2026-10-21-trimmed.json` and the
**pipes capture** `frm-getPipes-2026-10-21-connections-trimmed.json`. Each keeps a handful of records with geometry
removed, plus counts and sizes measured over the full response.

### New evidence

| Fact | Evidence |
| --- | --- |
| Every belt, lift and pipe carries `ConnectedTo0` and `ConnectedTo1`: the id of the building or conveyor at that end, `""` when the end is open | All three captures: 1,987 belts, 257 lifts, 156 pipes. `ConnectedTo<n>` is non-empty exactly when `Connected<n>` is true in every record. Open ends: 43 belts have one or both ends open (20 at end 0 only, 14 at end 1 only, 9 at both), no lift, 2 pipes |
| The ids are the same ids `getFactory` returns | Belts capture: 332 of the 340 `getFactory` buildings read the same minute appear as an end; the contract already carries that id (`packages/shared/src/factory.ts:41-43`) |
| Splitters, mergers, smart splitters, storage, train stations, miners, generators, the sink, pipe junctions and pumps are known as nodes | Their ids appear only as conveyor ends (belts and pipes captures, endpoint classes); none is in `getFactory` |
| Belts and lifts are oriented: items enter at end 0 and leave at end 1 | Miners only ever at end 0; generators, the sink, central storage and the space elevator only at end 1; splitters at end 0 of 811 belts and end 1 of 436, mergers the reverse (belts capture). Lifts agree (lifts capture). Belt-to-belt joins are consistent: all 398 name each other end 1 to end 0 |
| Pipes are **not** oriented | Coal generators are end 0 of 19 pipes and end 1 of 5 (pipes capture) |
| `ItemsPerMinute` is the tier's speed, not the flow on the belt | One constant per tier over all 1,987 belts and 257 lifts: Mk.1 60, Mk.2 120, Mk.3 270, Mk.4 480 (belts and lifts captures); `frm-getBelts.md` E2 calls it the belt's speed. Whether it equals the game's real throughput cap at every tier is not in raw-sources [NEEDS VERIFICATION]; the values are the ones the earlier capture recorded |
| Pipe `Speed` is 5 on every Mk.1 pipe | Pipes capture. Its unit is not documented (5 a second would be 300 a minute) [NEEDS VERIFICATION]; the save has no Mk.2 pipe to compare |
| What is still missing | No port name or index on either end (belts capture); no connection fields on splitters, mergers or machines themselves, so an edge is seen only from the conveyor's side; no flow or fill on any conveyor; smart-splitter filter rules; splitter and merger throughput caps (none in raw-sources [NEEDS VERIFICATION]) |
| When FRM added the fields | The mod session's G0 research names FRM commits `136a3e4b` and `95d8bfb0` (2026-10-07, releases 1.5.4-510 and later); that research is not in raw-sources yet [NEEDS VERIFICATION]. What is verified is that 1.5.4 on the owner's server returns them |
| Read cost | Full responses: `getBelts` 3,658,143 bytes in 0.22 s, `getLifts` 204,799 bytes in 0.02 s, `getPipes` 274,176 bytes in 0.03 s, over loopback (captures). 73 % of the belt bytes are geometry and paint the finder never uses. `getBelts` and `getPipes` are not game-thread endpoints (`frm-read-api.md` E2); `getLifts` is not in that index at all, so its game-thread status is undocumented [NEEDS VERIFICATION] |

### Decision 1: belt-level root cause is a go on FRM data

The graph the original decision could not build is now read directly: conveyor identities, both ends, orientation for
belts and lifts, tier caps, and splitters, mergers and storage as nodes. That removes every reason for the no-go except
"no flow", and a tier cap on a min cut is a cap whether or not the belt is full today. **The belt-connection mod claim is
not needed and stays unfiled** in `wiki/mod-claims.md`; see "What the mod might still add".

### Decision 2: read cost, cadence and where the data is cut down

- **Endpoints:** `getBelts`, `getLifts`, `getPipes`, read back to back in one cycle (about 0.3 s on this save, so the
  three agree with each other).
- **Cadence:** ADR-0038's world tier, every 10 min jittered and once after start (`agent/src/worldReader.ts:14`, `:18`),
  never at the 5 s or 30 s snapshot cadence. The graph changes only when the player builds. At 0.3 s of FRM web-server
  work per 10 min, the FRM side is under 0.1 % duty. Parsing 3.7 MB of JSON in the agent every 10 min is small
  [estimate, not measured]. Because `getLifts`' game-thread status is undocumented, the tick-rate check ADR-0038 already
  runs on the first real-server read covers this cycle too.
- **A cheaper change signal (an early read when the factory snapshot's set of building ids changes): not yet.** The
  10 min graph plus a staleness rule (Decision 3) is honest. Trigger: the owner reports stale findings after building.
- **Stripping happens in `packages/game-adapter/`**, in a new mapper beside the rails one: raw FRM shapes stop there
  (ground rule 5). It keeps per conveyor `{ id, kind, from, fromKind, to, toKind, capacityPerMinute, tier, at }` (below)
  and drops `SplineData`, `BoundingBox`, `ColorSlot`, `features` and `location`. Edges sorted by `id`, `at` rounded to
  whole metres, so the hash is stable.
- **Transport:** a new world layer `conveyors` on the existing pipeline: the agent hashes the projection and POSTs
  `/agent/v1/world/conveyors` **only when the hash changed** (`worldReader.ts:109-110`, ADR-0038). The backend stores it
  as one `map.world_layers` row (`backend/migrations/1791158400000_map_world_layers.sql:27-36`, keyed by a free-text
  `layer`), so no migration. Local servers use `map/services/localWorldPoller.ts` on the same schedule.
- **Size:** the projection measured over today's full responses is 2,400 edges, 647 KB uncompressed (about 270 bytes an
  edge), 49 KB gzip. It goes through the world-ingest route's 2 MB cap (`packages/shared/src/map.ts:44`,
  `backend/src/modules/map/routes/agentWorldRoutes.ts:56`), not the snapshot, so #514's snapshot budgets
  (`agents/config.ts:31`, `:48-54`) are unchanged. The shared item cap `MAP_WORLD_MAX_ITEMS` (5,000, `map.ts:51`) is too
  small for a bigger factory: the conveyors layer gets its own cap of 50,000 edges. **Trigger:** a projection over
  1.5 MB (about 2.3 times this save) switches to an interned form (a node table plus index pairs) or folds unbranched
  belt and lift chains into one edge that keeps the id of its slowest segment. Over 2 MB the layer is skipped as
  ADR-0038 says, and the finder falls back to item level with a note.
- **Version gate:** the adapter checks that `ConnectedTo0` and `ConnectedTo1` are present. An older FRM without them
  sends no conveyors layer, and that server's finder runs item level only, saying "belt data needs FRM 1.5.4 or newer".

### Decision 3: the model

Two graphs, joined by building id: ADR-0048's item graph from the factory snapshot (unchanged), and a **connection
graph** from the conveyors layer.

- **Nodes:** every id that appears as a conveyor end, typed by the adapter from its class (`machine`, `splitter`,
  `merger`, `storage`, `station`, `extractor`, `consumer` for generators, the sink and the space elevator, `junction`
  for pipe junctions and pumps, `conveyor` for a belt or lift joining another directly).
- **Arcs:** each belt or lift is one arc end 0 to end 1 with capacity `ItemsPerMinute`. Each pipe is two arcs, one each
  way, with the same capacity, because pipe ends are not oriented. Splitters, mergers, junctions and storage are
  uncapped pass-through nodes (no cap is cited). An open end adds no arc; the conveyor stays as a dead end.
- **Which item flows where** is not on the conveyor, so it is derived per (consumer M, ingredient X): walk the arcs
  backwards from M to get M's upstream region R(M). Producers of X in R(M) are X's real suppliers for M. This also
  fixes the original "aggregation hides geography" consequence: supply for M is what can reach M, not the factory total.
- **Max-flow per (M, X):** Dinic over R(M), from a super-source to M. Arcs from the super-source go to each producer of X
  in R(M), with capacity that producer's `maxPerMinute` for X, and to each extractor, storage or station in R(M),
  uncapped and flagged, because its item and rate are unread until follow-up 5. The arc to the super-sink is M's demand
  `maxPerMinute` for X. If the flow is below that demand, the **min cut** names the conveyors that cap it: the
  residual-reachable cut, lowest capacity first, then `id`. On this save R(M) is at most about 2,550 arcs, so each run
  takes well under a millisecond to a few milliseconds; per-item results are memoised. The existing "over ~50 ms,
  cache per snapshot and graph hash" trigger stands.
- **Shared manifolds:** a second Dinic per item X over the whole graph, from all X producers to all X consumers, finds a
  cut that starves several consumers at once ("this Mk.2 belt caps the 12 Wire consumers behind it at 120/min").
- **Verdicts,** ranked as before, with two additions:
  1. `noProducer`: nothing in the factory makes X.
  2. `notConnected` (new): nothing upstream of M's inputs makes X, and no extractor, storage or station is upstream
     either. The belt-level form of "missing input".
  3. `deficit`: now **local**: the producers of X that can reach M make less than the consumers they feed want.
  4. `upstream`: as before, with `unpowered`, `paused` and `idle` as terminals.
  5. `logistics` with `cappedBy` (new field): a min cut below demand. "A Mk.1 belt (60/min) from the splitter to this
     constructor caps Iron Plate at 60/min; it wants 90." Through pipes the same, once their capacity unit is verified.
  6. `logistics` without `cappedBy`: supply and belts are both enough, and it still starves. That leaves splitter
     balancing, smart-splitter filters, mixed belts or overflow to storage, which the data cannot tell apart. Said plainly.
  Backed up mirrors this downstream (`noConsumer`, `surplus`, `downstream`, `logistics` with a capping output belt).
- **Known optimism:** max-flow assumes ideal routing, and real splitters split evenly, so a reported cap is real but some
  starvation shows only as case 6. Per-item flows ignore other items sharing a belt: a cut on a conveyor that is
  upstream of producers of two items says "shared with Y". Fluid head and pump power are not modelled.
- **Staleness:** the graph can be up to 10 min older than the factory snapshot. A machine in the snapshot whose id no
  conveyor names falls back to its item-level verdict with "connections refresh within 10 minutes". (8 of 340 buildings
  have no conveyor today, belts capture; they are idle or attached directly, see Risks.)
- **Top 10** (the owner's answer 2): ADR-0048's ranking, where a shared root cause now includes a shared capping
  conveyor: one cut that starves twelve assemblers outranks one unlocated `logistics` case.
- **Deterministic:** arcs sorted by `id`, ties by item `className` then building id; no time, no randomness.

### Decision 4: contract, components and build split

Contract sketch (additive per ADR-0007; its own PR):

```ts
// packages/shared/src/map.ts: a new world layer
KNOWN_MAP_WORLD_LAYERS = ["rails", "resourceNodes", "conveyors"];
ConveyorEdgeSchema = z.object({
  id: z.string().max(128),
  kind: z.enum(["belt", "lift", "pipe"]),
  from: z.string().max(128).nullable(),                 // end 0; null = open end
  fromKind: ConveyorNodeKindSchema.nullable(),          // machine | splitter | merger | storage | station | extractor | consumer | junction | conveyor | other
  to: z.string().max(128).nullable(),                   // end 1
  toKind: ConveyorNodeKindSchema.nullable(),
  capacityPerMinute: z.number().min(0).nullable(),      // null for pipes until their unit is verified
  tier: z.string().max(64),                             // display name, e.g. "Conveyor Belt Mk.1"
  at: z.object({ x: z.number(), y: z.number() }),       // end 0, whole metres, for "near (x, y)"
});
ConveyorsLayerDataSchema = z.array(ConveyorEdgeSchema).max(CONVEYORS_MAX_EDGES /* 50_000 */);

// packages/shared/src/bottlenecks.ts: ADR-0048's sketch plus
BottleneckStepSchema.kind += "notConnected";
BottleneckStepSchema.cappedBy = z.object({
  conveyorId: z.string(), kind: z.enum(["belt", "lift", "pipe"]), tier: z.string(),
  capacityPerMinute: z.number().min(0), fromId: z.string().nullable(), toId: z.string().nullable(),
  at: z.object({ x: z.number(), y: z.number() }),
}).optional();
BottlenecksSchema.beltData = z.enum(["present", "stale", "unsupported", "tooLarge"]);  // says which mode ran
```

Build split: five PRs, each from `main` (no stacked PRs). Nothing is visible until PR 5, so the owner gets one complete
feature.

1. **Contract** (`packages/shared/`, backend session): the conveyors layer, its cap, `bottlenecks.ts`, the endpoint
   entry, fixtures built from the three new captures. Verified by schema tests and typecheck.
2. **Read and send** (`packages/game-adapter/` data-adapter, then `agent/src/worldReader.ts` and
   `backend/src/modules/map/services/localWorldPoller.ts`): lenient raw schemas for the three endpoints, the projection
   with the version gate, a `conveyors` loop at 10 min. Tests from the captures (orientation, open ends, pipe arcs both
   ways, sorted output, stable hash, missing fields leading to no layer). The rebuild G-check below runs during this PR.
3. **Finder** (`backend/src/modules/telemetry/services/bottleneckFinder.ts`, backend): item graph, connection graph,
   Dinic, verdicts, ranking, as a pure function of (buildings, edges). Tests: each verdict, a Mk.1 cap behind a
   splitter, a shared manifold cut, a pipe loop, an open end, a stale graph, a generated 10x factory within a time bound.
   Then `test-hunter`.
4. **Route** (`backend/src/modules/telemetry/routes/bottlenecks.ts`, backend): `GET /api/servers/:serverId/bottlenecks?limit=10`,
   session-guarded, reading the latest factory snapshot and the `conveyors` row through the map module's `index.ts`.
   Supertest route test.
5. **Frontend** (frontend session, `ui-reviewer`): the "Bottlenecks" section on the Factory page, top 10, each with its
   sentence and, when present, the capping conveyor's tier, rate and "near (x, y)"; built on design tokens; unknown
   `kind` shows the `text` only. This PR makes the feature visible.

Follow-ups 5 (extractors) and 6 (buffer fill) still wait for feedback (owner answer 3). Extractors matter more now: they
turn the uncapped, flagged sources into real rates.

### What the mod might still add

Port names or indices on both ends, and connection fields on splitters, mergers and machines themselves. Neither is
needed now: which input belt carries which ingredient falls out of the upstream walk, and every splitter and merger link
seen so far is seen from a conveyor. The mod-claims row stays unfiled. **Trigger:** the rebuild G-check or real use
shows machines fed by a direct port-to-port attachment (a splitter snapped to a machine with no belt), which no conveyor
would name [NEEDS VERIFICATION whether the game allows that and whether FRM reports it], or two inputs of one machine
carrying the same item where the port matters.

### Risks and G-checks

- **G-B1 (rebuild staleness), on the test server, never on the owner's game:** build a belt A to B, read `getBelts`,
  dismantle and rebuild it (and once to a different machine), read again. Pass: the old id is gone and the new
  `ConnectedTo` is right on the next read. Not verifiable from captures. Runs in PR 2; PR 3 does not merge without it.
- **G-B2 (pipe unit):** on the test server, a Mk.2 pipe's `Speed` beside a Mk.1's settles the unit. Until it passes,
  pipe arcs are topology only (`capacityPerMinute` null): the finder can say "no pipe path" but not "pipe cap".
- **Id stability across restarts** is unverified (`factory.ts:42-43`). The graph is re-read within 10 min of a restart
  and every join is by id within one pair of reads, so a change shows up as staleness, not wrong answers.
- **FRM version drift:** gate on the fields, not on a version number (Decision 2). The adapter's lenient schemas log a
  count of dropped records, as the rails mapper does.
- **Licensing of captures:** FRM carries no licence (`frm-license-status-2026-09-27.md`), and the mod session notes that
  docs.ficsit.app's footer says GPLv3 "except where otherwise noted". Either way, captures stay trimmed excerpts: a
  handful of records with geometry removed, counts and sizes, never full payloads.
- **Mixed belts and smart splitters** can make case 6 common on some saves. If owner feedback says it dominates, that is
  the evidence for per-item filter data (a later FRM field or the mod).

### Revisit when (amendment)

- G-B1 fails: connections are stale after a rebuild. Read on a change signal or on demand, or go back to the mod claim.
- The conveyors projection passes 1.5 MB on a real save: intern or fold chains (Decision 2).
- A finder request passes ~50 ms: cache per (snapshot, graph hash).
- Case 6 dominates on real saves: look for filter and port data.

### Owner answers (2026-10-21)

1. **Accepted.** Build the belt-level finder on FRM's connection data. The belt-connection mod claim stays unfiled.
2. **Pipes: hold the feature.** Nothing ships to users until G-B2 (the pipe `Speed` unit) passes, so the first version
   can name pipe caps as well as belt caps. PRs 1–4 may still be built and merged hidden. PR 5, the Factory page
   section that makes the feature visible, waits for G-B2 and G-B1.
3. **An older FRM without the connection fields:** show the item-level results with a note to update FRM to 1.5.4 for
   belt detail. Don't hide the section.
4. **Freshness:** a 10-minute connection refresh, with a note on the section that connections refresh every
   10 minutes. Add an early re-read on building changes only if stale results become a problem.

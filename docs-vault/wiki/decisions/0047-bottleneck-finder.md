# ADR-0047: Bottleneck finder over the item graph, not the belt graph

Status: proposed. Needs the owner's approval (the decision and the questions at the end). Issue #349.

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

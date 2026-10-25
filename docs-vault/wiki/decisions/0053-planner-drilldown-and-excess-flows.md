# ADR-0053: Planner drill-down by source tree, excess flows, and fewer unknown items

Status: **proposed** (architect, 2026-10-24; the owner reviews before anything is built). Amends ADR-0050 Decisions 1, 2,
3 and 8; everything else in ADR-0050 stands. Paths are under `backend/src/modules/` unless they start with a top-level
directory.

## Context

The owner's real save (2026-10-24): one site, "Versatile Framework site", holds 356 machines; its graph is hard to read
and some edges say "Item unknown". The owner's direction, verbatim: "its better to split by major component within a
recipe? Maybe be able to click a node to blow it up. remember its possible for a machine to produce excess of an item
and for the player to send it to a recycler or storage", and later: "when splitting by major item, make sure its item
from the same 'source factory'. If an item comes from different tree to the same output, they should be separate
bubbles that can explode." Cards also have no building pictures yet (icons will be exported from the game with FModel,
as #571 did for resource icons).

### What the code does today

| Area | Evidence | Problem |
| --- | --- | --- |
| Groups | One group per kind + class + recipe + feeding pass-through signature (`telemetry/services/productionGraph.ts:247-266`) | Right unit, but a 356-machine site has far too many of them to lay out flat |
| Sites | Atoms are weakly connected components of the raw conveyor graph (`productionGraph.ts:513-534`), merged within 150 m (`:535-547`) | A shared sink manifold, an overflow belt into one container, or a dense base glues unrelated lines into one site |
| Terminal kinds | `storage`, `station`, `consumer` are sink kinds (`connectionGraph.ts:18`); `consumer` is a generator, the sink or the space elevator (`packages/shared/src/map.ts:108-111`) | Nothing distinguishes "excess into storage" from "the line's input" |
| Item, data-less destination | One fitting product: that item; two or more: `null` (`productionGraph.ts:411-416`) | Unknown item |
| Item, data-less source | Extractor: the destination's single unmet need (`:417-423`); storage, station or `other` as a source: always `null` (`:424-425`) | Most "Item unknown" edges: storage outputs and miners into storage |
| Extractor position | Borrowed from a conveyor end, as extractors are not in `getFactory` (`:241-243`) | Good enough to find the resource node under it |
| Resource nodes | The `resourceNodes` layer keeps the display name only (`packages/shared/src/map.ts:82-89`); FRM sends `ClassName` too (`raw-sources/captured-responses/frm-getResourceNode-2026-09-27-trimmed.json`, e.g. `"Name":"Iron Ore","ClassName":"Desc_OreIron_C"`) | Item class lost at projection |
| Sink rates | Rate known only when the sink is the source's single destination (`productionGraph.ts:472-480`) | An overflow edge has no rate |
| Layout | `layoutSite` is synchronous dagre over the whole site, dropping edges with an end outside it (`frontend/src/planner/graph/layoutSite.ts:131-133`; called in a `useMemo`, `SiteGraph.tsx:87`) | Every node of the site at once; cross-site edges vanish. ADR-0050 Decision 3 described an async boundary that the code does not have |
| Labels | "Item unknown" for a null item (`frontend/src/planner/graph/graphModel.ts:73-74`) | |

## Decision

### Decision 1: every edge gets a flow class; excess and outputs never glue

For a candidate edge (source group `s`, destination group `d`, item `X`), after item inference (Decision 4):

- **`supply`**: `d` is a machine group with `X` among its ingredients, or a storage or station node that has its own
  outgoing edges carrying `X` (a buffer).
- **`excess`**: `d` is a **terminal** (a `consumer`, or a storage/station/`other` node with no outgoing edges) and `s`
  also has at least one `supply` edge for `X`. The overflow splitter case: the surplus beyond what the line uses.
- **`output`**: `d` is a terminal and `s` has no `supply` edge for `X`: the line's end product into storage, a sink, a
  loading platform or a generator.

These are legitimate flows, not errors (no note counts them). **Excess rate:** `s`'s measured output of `X` minus the
sum
of its `supply` edges for `X`, when every one of those has a number and `s` has exactly one `excess` destination for `X`;
`estimated`, never `measured`; otherwise `unknown`. **Shown as:** a dotted neutral-ink edge labelled "excess" or
"output", with the destination's kind in words ("Excess Iron Plate to storage"); no new colour (ADR-0041 keeps red for
failure, blue for paused, amber for the accent).

**A recycler** (owner's word) is a machine group whose recipe is in a `TERMINAL_RECIPES` set, empty until the owner
names the recipes (Question 1). A recipe in that set is treated as a terminal for gluing only; its edges keep their
items and rates.

### Decision 2: sites are built from supply edges, with terminals attached, not from raw conveyor components

- **Atoms:** union-find over groups, joining `s` and `d` for every `supply` edge only. A group with no supply edge is its
  own atom.
- **Terminals attach** to the atom of their largest feeder (most machines, then lowest key). Their other incoming
  edges become **cross-site** edges when the feeder is in another site.
- **Sites:** atoms merged within `SITE_MERGE_DISTANCE_M` (150 m) exactly as today (`productionGraph.ts:535-547`). Site
  keys and names unchanged in form.
- Cross-site edges stay in `edges`; the frontend draws them as a short stub at the node, labelled with the other site's
  name, instead of dropping them (`layoutSite.ts:133`).
- Consequence on the owner's save: a central sink or overflow container no longer merges distant lines. A dense base
  within 150 m stays one site; that is what Decision 3 is for. PR 3 logs component and site counts before and after
  (`ProductionGraphStats`).

### Decision 3: drill-down by bubble (recipe x source tree), expanded in place

**Source tree (the owner's "source factory").** For a machine group `g`, its upstream closure `U(g)` is every machine
group reachable from `g` backwards over `supply` edges, including `g`, passing through buffers (storage or stations that
have supply inputs) but never entering a **raw source**: an extractor, or a storage, station or `other` node with no
supply inputs. Two groups of the same recipe in the same site are in the same **bubble** when their closures share a
machine group (transitively, by union-find). So:

- the same item reaching one consumer from two upstream trees is two bubbles;
- one miner (or one unloading platform) feeding two trees does not join them: raw sources are shared inputs, not a
  factory;
- a loop: all groups of one strongly connected component (already computed, `productionGraph.ts:498-505`) reach each
  other, so their closures intersect and same-recipe groups in a loop are always one bubble;
- a shared intermediate (one smelter group feeding two plate manifolds) makes the two plate groups one bubble.

**Computation (deterministic, linear per recipe):** per site and recipe, take its groups in key order; from each, walk
backwards over supply edges marking groups with that start's index; on reaching a group already marked by another
start, union the two and stop that branch (its upstream is already marked). Cost O(R x (V + E)) per site, R recipes
(at most a few tens on a 150-group site). `treeKey` = `tree|` + the bubble's lowest group key, valid for one response.

**Non-machine bubbles:** extractors by (class, item), terminals by (kind, class, item received), per site; a raw source
never splits a tree, so it never needs its own tree.

**Worked example.**

```
M1 (Miner, Iron Ore) -> S1 (Smelter, Iron Ingot) -> P1 (Constructor, Iron Plate) -+-> A (Assembler, Reinforced Plate)
                         S1 -> C (Constructor, Screw) ----------------------------+
M2 (Miner, Iron Ore) -> S2 (Smelter, Iron Ingot) -> P2 (Constructor, Iron Plate) -+
P1 -> overflow splitter -> K (Storage, no outputs)
```

U(P1) = {P1, S1}, U(P2) = {P2, S2}: disjoint, so **two Iron Plate bubbles** ("Iron Plate, 1 of 2" and "2 of 2"), and
two Iron Ingot bubbles. P1 to K is `excess` (P1 also supplies A), so K does not glue anything and attaches to P1's atom.
If M1 fed both S1 and S2, still two bubbles (a miner is a raw source). If S1 fed both P1 and P2, U(P2) would contain S1
and the plates would be **one bubble** of two groups. The collapsed view: Miner Iron Ore (2) -> Iron Ingot 1/2, 2/2 ->
Iron Plate 1/2, 2/2 and Screw -> Reinforced Plate; Iron Plate 1/2 to Storage, dotted "excess".

**Levels and interaction (frontend):**

- **Collapsed** (default when a site has more than `COLLAPSE_AT = 30` group nodes; smaller sites open as today): one
  card per bubble: "12x Constructor, Iron Plate", with its ordinal when the recipe has several bubbles, actual over max
  products, and a card size step by machine count (three steps, log scale).
- **Click (or Enter) on a bubble** expands it in place into its groups, drawn inside a labelled frame (dagre compound
  node, `setParent`) with a "Collapse" button; other bubbles stay collapsed. "Collapse all" and "Expand all" in the
  toolbar, and Escape collapses the last one. The group panel (`GroupPanel.tsx`) opens from a group, as today.
- **Fold cap:** a recipe with more than 6 bubbles in one site shows the 5 largest and one "N more Iron Ingot trees"
  bubble that expands into the rest (Question 2).
- **Edges at each level:** the underlying group edges summed by (from card, to card, item, kind, flow). Quality is the
  weakest part: all `measured`, measured; any part with a number, "about" the sum of the known parts, with "at least"
  when some part is `unknown`; none known, no number. `mixed` if any part is. The item filter and reachability run on
  the group graph and light every card that contains a lit group.
- **Expansion state** is UI state for the session, keyed by `treeKey`; a refetch that changes the keys collapses what no
  longer exists, nothing is stored.
- **Text form:** the per-site table lists bubbles, each with its groups as indented rows; same words as the canvas.
- **Motion:** a re-layout eases nodes from old to new positions (ease-in-out, off under reduced motion), matching the
  workspace's motion rule.
- **Icon slot:** every card reserves a square at the start of its title, filled from a `className` to asset map
  (`frontend/src/planner/buildingIcons.ts`, modelled on `frontend/src/map/resourceIcons.ts`), empty until the FModel
  export lands; the fallback is a kind glyph in token colours. No contract change: `className` is already on the node.

### Decision 4: fewer unknown items, and saying where an item came from

In this order, each a pure step in the service:

1. **Extractors from the resource node under them.** The extractor's position is the end-0 point of a conveyor whose
   `from` is the extractor (not a pipe's arbitrary end); the nearest node in the `resourceNodes` layer within 20 m wins
   when the second nearest is at least twice as far [estimate: the output-port offset from the node centre is
   `[NEEDS VERIFICATION]`; PR 4 checks it on the owner's save and tunes the radius]. Water extractors by class (Water,
   no node). Needs the node's `className` (contract, Decision 5).
2. **Data-less sources from upstream:** a storage or station node's out edges carry the single item its incoming edges
   carry (iterated to a fixpoint, bounded by the node count, for storage chains); else the destination's single unmet
   need, the rule extractors use today (`productionGraph.ts:417-423`), generalised to any data-less source.
3. **Several fitting products** into a data-less destination: one edge per item, `mixed: true`, rate `unknown`, instead
   of one null edge (`:415`).
4. **What remains unknowable** (stays `null`, with "Item not inferred" in the one wording both views use): a sushi belt
   into storage with no machine downstream that consumes from it, smart or programmable splitter filters, an extractor
   with no node within the radius, an unloading platform feeding only storage (until ADR-0050 Decision 6 reads train
   cargo), modded or unrecognised (`other`) buildings, and every rate into generators and the sink beyond Decision 1's
   remainder.

Each inferred item says how: `itemFrom` = `recipe` (both ends' recipes), `resourceNode`, `upstream`, `downstream`; the
tooltip says "inferred from the resource node" and so on, and inferred items keep downgrading a single-source rate to
`estimated` as today (`productionGraph.ts:455`).

### Decision 5: contract changes, additive (ADR-0007), as their own PR

New enum-like fields are plain strings with known values, like `PlannerNode.kind`, so a newer value never breaks an
older frontend.

```ts
// packages/shared/src/productionGraph.ts
PlannerEdgeSchema += {
  flow: z.string().max(20).optional(),      // known: supply | excess | output; absent = supply (older backend)
  itemFrom: z.string().max(20).optional(),  // known: recipe | resourceNode | upstream | downstream
};
PlannerNodeSchema += {
  treeKey: Key.optional(),                  // the bubble; absent = frontend groups by (kind, className, recipe) per site
  resource: z.object({ className: Name, name: Name }).nullable().optional(), // an extractor's inferred item
};
// packages/shared/src/map.ts
ResourceNodeSchema += { className: z.string().max(200).optional() }; // FRM ClassName, e.g. Desc_OreIron_C
```

No new caps: per-item mixed edges stay inside `PLANNER_MAX_EDGES`. Fixtures gain a two-tree site with an overflow.

### Decision 6: backend computes classes, trees and items; the frontend aggregates and lays out

- **Backend** (`telemetry/services/productionGraph.ts`, the route reads `resourceNodes` beside `conveyors` through
  `map/index.ts`): flow classes, supply-based atoms, terminal attachment, `treeKey`, item inference, excess rates. One
  pure function stays the source of truth for the table and the canvas.
- **Frontend** (`frontend/src/planner/graph/`): a pure `hierarchy.ts` (bubbles from `treeKey`, the expansion set to
  visible cards and aggregated edges), the frame and stubs in `SiteGraph.tsx`, the icon slot in `layoutSite.ts`
  `nodeSize`.
- **Performance:** the backend adds O(R x (V + E)) per site, inside ADR-0050's 50 ms rule, with PR 3's generated-10x
  bound extended. The frontend lays out only visible cards: a collapsed 356-machine site is a few tens of cards
  [estimate]; fully expanded it is today's graph. Each expand is a re-layout, so the ADR-0050 worker trigger (a layout
  over 100 ms on the largest site) is now measured on "Expand all" of the largest demo site, in a unit test with
  `performance.now()` and a generous bound. Layouts are memoised per (site, expansion set), last 8 kept. The cheap step
  ADR-0050 asked for, still missing: put `layoutSite` behind an async function now, so a worker changes no caller.

### Decision 7: build PRs (each from `main`, merged in order, not stacked; hidden behind nothing new, the Planner is live)

1. **Contract** (`packages/shared/src/productionGraph.ts`, `map.ts`, fixtures): Decision 5. Tests: old responses
   (without the fields) and new ones parse; unknown `flow` values parse.
2. **Resource node class** (`packages/game-adapter`, the `resourceNodes` projection): keep FRM `ClassName`. Test against
   the captured response above. A layer hash change rewrites the row once.
3. **Flows, sites, trees** (`productionGraph.ts`): Decisions 1 to 3's backend part. Tests: overflow splitter gives one
   `supply` and one `excess`; an output into storage; a shared sink manifold no longer joins two far lines; the worked
   example's two Iron Plate bubbles, the shared-miner variant (still two), the shared-smelter variant (one); a loop is
   one bubble; byte-identical output on a shuffled input; the 10x bound. Reviewer: `test-hunter`.
4. **Items** (`productionGraph.ts`, the route): Decision 4, the `resourceNodes` read. Tests: a miner on a node, a
   miner between two nodes (ambiguous, stays null), storage passing its upstream item, a storage chain, two products to
   storage as two mixed edges, the unknowable cases still null. Then run on the owner's save and record the count of
   null-item edges before and after in the PR. Reviewer: `test-hunter`.
5. **Hierarchy and text form** (`frontend/src/planner/graph/hierarchy.ts`, the site tables, `plannerText.ts` words for
   flows and `itemFrom`): pure aggregation tests (rate quality rules, fold cap, fallback without `treeKey`), demo data
   with two trees and an overflow in `src/demo/`, a scenario. Reviewers: `test-hunter`, `ui-reviewer`.
6. **Canvas drill-down** (`SiteGraph.tsx`, `layoutSite.ts`): collapsed default above `COLLAPSE_AT`, expand and collapse
   by pointer and keyboard, compound frames, dotted excess and output edges, cross-site stubs, the icon slot with its
   fallback, eased re-layout, the layout bound test, e2e for expand/collapse and axe. Reviewers: `ui-reviewer`,
   `test-hunter`.

## Consequences

- A big site opens as a few tens of cards and the player drills into the tree he cares about; the same item from two
  factories is never merged into one card.
- Overflow and end-of-line storage are visible as such and stop gluing lines into giant sites; site names and counts on
  existing saves change once.
- Fewer "Item not inferred" edges, each inferred one saying how; the remaining unknowns are listed above.
- Positions move on each expand (dagre does not keep them); the eased transition softens it.

## Revisit when

- A bubble expands into more than about 40 groups on a real save: add a middle level (the bubble's pass-through
  components).
- "Expand all" on the largest site lays out in over 100 ms: move `layoutSite` into a worker (ADR-0050 Decision 3).
- The 20 m resource-node radius mismatches on the owner's save: tune it, or read `getExtractor` once captured.
- Train cargo is read (ADR-0050 Decision 6): stations stop being terminals for item inference, and stay terminals for
  sites.

## Questions for the owner

1. **"Recycler":** which recipes or buildings do you mean (for example the Recycled Rubber or Recycled Plastic
   refinery recipes, the sink, something modded)? They go in `TERMINAL_RECIPES` so excess into them never glues lines.
   Until you name them, they are ordinary machines.
2. **Fold cap:** many small trees of the same recipe (ten miner-smelter pairs) make ten bubbles. Fold beyond 6 into
   "N more trees" (recommended), or always show every tree?
3. **Bubble by recipe or by product:** two recipes making the same item (an alternate beside the standard) are separate
   bubbles under this ADR. Keep that (recommended, matches the groups), or merge by product within a tree?
4. **Collapse threshold:** collapsed by default above 30 group nodes (recommended), or always collapsed?

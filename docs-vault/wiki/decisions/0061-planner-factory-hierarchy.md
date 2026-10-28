# ADR-0061: Planner factory hierarchy (nested factories, blow-up in place, nested ?open= and Back)

Status: **Accepted** (owner, 2026-10-27), with the owner's answers below. Proposed the same day from an independent
`architecture-advisor` review of `main`, from the owner's feature list ("Allow nested factories", "Currently can't 'blow up' a
factory to let it expand in its 'one level up' graph"). Amends ADR-0055 (Decision 5, designations) and ADR-0050 (levels). Paths
are relative to `frontend/src/planner/` unless they say otherwise. Nothing here reads a new game field.

## Owner answers (2026-10-27)

1. **Depth.** At most 3 levels (a factory in a factory in a factory).
2. **A parent may also own machines directly** (not "container or leaf"). Decision 1 below is written for that answer.
3. **Automatic factories.** "Group into a new factory" accepts automatic (undesignated) factories and designates each of them in
   the same step. This replaces the Keep flow, which goes away with "Reason factories for me" (owner, 2026-10-27).
4. **Blow up.** Both a parent (into its child factories) and an ordinary factory (into its machine groups) expand in place, up to
   a card cap; past it the control says to open the factory instead.
5. **Expanded state** stays in the session, not the URL (the recommended default; not asked separately).
6. **A parent's outputs** are net of flows between its children, reading "at least" where an internal flow's rate is estimated
   or unknown (the recommended default; not asked separately).

## Context

- **A designation is flat.** `PlannerDesignationSchema` is `id`, `name`, `mode`, `members` (min 1, max 1000), timestamps and
  `revision` (`packages/shared/src/plannerDesignations.ts:75-83`). One building belongs to at most one designation (that file's
  header; ADR-0055 Decisions 11 and 12).
- **A factory has no parent.** The graph's factory carries `designationId` (nullable, `packages/shared/src/productionGraph.ts:124`)
  and `sharedNodeCount` (`:130`). Automatic factories (ADR-0055 Decision 4) are recomputed on each read and are flat.
- **Two levels.** `SceneLevel = "overview" | "factory" | "site"` (`graph/canvasScene.ts:136`). `overviewScene(graph, models)` draws
  one card per factory and aggregates flows with `aggregateFlows(flowParts(graph), (key) => owner.get(key))`
  (`canvasScene.ts:486-499`); `owner` maps a group to its factory.
- **In-place expansion exists one level down.** A bubble opens into its groups inside a `Frame` (`canvasScene.ts:143, 652-708`),
  and `layoutSite.ts:355-416` lays frames out as dagre compound nodes with a header tab (`FRAME_HEADER_H`, `layoutSite.ts:49`).
- **Opening is one key.** `?open=<key>` (`PlannerView.tsx`, #776); opening is a history entry and Back goes up a level.
- **Layout budget.** dagre is a lazy chunk; a layout past 100 ms is a problem (ADR-0050 Decision 3, ADR-0060 Decision 3).

## Decisions

### 1. Hierarchy is a parent pointer on designations; a building still has one owner

- A designation gains `parentId: uuid | null`. A designation may have children **and** its own `members` (owner answer 2).
- The overlap rule is unchanged: a building belongs to at most one designation, at any depth. A parent's own members and its
  children's members are disjoint, so matching (`designationMatch.ts`), replace and undo keep their single-owner checks.
- A parent's machines are its own members plus all its descendants'. A parent with no members and no children is not allowed.
- Depth: at most `PLANNER_DESIGNATION_MAX_DEPTH = 3`. The per-server cap of 50 designations counts parents too.
- Rejected: listing a child's members again in the parent (two owners per building breaks every overlap check); a separate
  "groups" store (a second noun with its own revision and undo).

### 2. The backend graph stays flat; the client rolls up

- The backend builds one factory per designation from that designation's **own** members, plus automatic factories, as now.
  A parent with own members is therefore an ordinary factory in the graph; a parent without them has no graph factory.
  `productionGraph.ts`'s factory building is unchanged apart from reading `parentId` through to `PlannerFactory` (Contracts 5).
- The client already holds the designation list (`DesignationContext.tsx`) and derives a tree in `factoryTree.ts`: each model gets
  `parentKey`, `depth` and `childKeys`. A parent's card is a roll-up: machine and state counts are sums; outputs are its own and its
  children's outputs minus what flows between them, clamped at 0, reading "at least" when an internal flow is estimated or unknown.
- On a parent's own level, its directly owned machines show as one card named after the parent ("Main base (own machines)"),
  beside its child factories, so every machine is drawn exactly once.

### 3. Scenes take a path

- `overviewScene(graph, models, path)` shows the children of the last path element (the top level when the path is empty). Its
  `owner` maps each group to the **shown ancestor**, so flows inside one shown card vanish and flows across cards aggregate with
  the existing owner-keyed `aggregateFlows`.
- Opening a parent shows its children as cards on the `overview` level; opening a factory without children shows its groups, as
  today. `SceneLevel` does not change; `Scene` gains `path: string[]` (a frontend type).
- Accessible names say where they are: "Factories in <parent name>".

### 4. ?open= is a path, and Back pops one element

- **Encoding.** Repeated parameters, root first: `?open=a&open=b`. A repeated parameter needs no escaping scheme, whatever
  characters a key holds. `params.getAll` replaces `params.get`; a link with one `open` is a path of length 1, so links made by
  #776 keep working.
- **Validation.** Keep the longest prefix in which each element is a child of the one before; drop a bad tail and say so in a
  `role="status"` line ("That factory is no longer here"). Never throw.
- **Back.** The #776 rule extends to "pop the last element": step back through history when the Planner made the entry, otherwise
  replace the address with `path.slice(0, -1)`. Focus after Back is unchanged.
- **Breadcrumb.** The header shows the path as buttons ("All factories / Main base / Iron area"); each sets the path to its prefix.
  It is also the keyboard and screen-reader path to any ancestor.

### 5. Blow up: expand a card in place into a frame, reusing the bubble frame

- A card with children or groups gets an **Expand** control, on the canvas and in the DOM layer. It adds the card's key to
  `expanded: Set<string>`; the scene replaces the card with a `Frame` holding its children's cards (or its groups), and flows
  re-aggregate at the finest visible owner. Collapse removes the key; Expand all and Collapse all join the toolbar.
- **Layout.** The compound-node path of bubble frames (`layoutSite.ts:355-416`). Frames nest at most 2 deep in one scene; a third
  level opens by navigating. `expanded` joins the layout memo signature.
- **Budget.** At most `EXPAND_MAX_CARDS = 120` visible cards after expanding. Past it the control is disabled and its tooltip (a
  text node) says "Too large to expand here; open it". The expanded layout is measured in build PR 4 on ADR-0060's synthetic
  160-group site and the number recorded here (see the note below: measured, and the cap came down to 60); past 100 ms the
  cap comes down, not a worker.
- **Persistence.** `expanded` is remembered per path for the session, like fold state (owner answer 5).
- **Motion.** Cards glide with the existing tween (`--duration-slow`, `--ease-standard`); reduced motion jumps. No `style=`.
- **Note (2026-10-28, build PR 4: measured, and what the Decision left open).**
  - *Benchmark.* `layoutScene` (dagre plus the orthogonal router), the median of five cold runs (memo cleared) after one
    warm-up, in Vitest on the owner's dev machine, on a synthetic 160-group site shaped as 4 parents of 4 factories of 10
    groups with 211 lines (`wideTreeWorld(4, 4, 10)` in `src/test/plannerTree.ts`). For reference the same machine lays
    out the flat `planner-large` site (160 groups, 210 lines, no frames) in 40 ms. Frames are what cost: dagre's compound
    nodes, more so nested.

    | Shape | Cards | Frames | Lines | ms |
    |---|---|---|---|---|
    | Closed | 4 | 0 | 3 | 1 |
    | Parents blown up | 16 | 4 | 15 | 9-11 |
    | Expand all at the cap of 60 | 52 | 8 (4 nested) | 64 | 75-76 |
    | One factory of 59 groups | 59 | 1 | 76 | 45-48 |
    | Two deep, past 60 (not allowed) | 61 / 70 / 88 / 115 | 9 / 10 / 12 / 15 | 94-158 | 95 / 103 / 153 / 180-187 |
    | One deep, past 60 (not allowed) | 88 / 115 | 8 / 11 | 126 / 158 | 86 / 117 |

    120 cards two deep is about 180 ms, so by the rule above **`EXPAND_MAX_CARDS` is 60** (61 cards two deep is 95 ms, at
    the edge). `layoutScene.blowUp.test.ts` re-measures the first four rows on every run and warns past 100 ms.
  - *Flag.* All of blow-up, a plain factory into its groups too, ships behind `planner.nesting` (Decision 7): the Decision
    describes both kinds as one control, and it has not been through the owner's demo review (build PR 6) yet. With the flag
    off the overview is drawn exactly as before (no pill, no extra card height), so no screenshot changes.
  - *Which cards.* Any overview card with at least one part: a parent (its parts, the own-machines card among them) or a
    leaf or own-machines card (its groups, each group once: the group's factory is the one `factoryOfNode` gives it). A
    blown-up factory's groups are plain group cards: they open the group panel, and do not open into their machines (that
    would be a third frame).
  - *Depth.* A card's frame depth is counted in the scene: a top card's frame is depth 1, a part blown up inside it depth 2,
    and a card inside a depth-2 frame shows no Expand control. Order is depth-first in scene order; the cap is checked as
    each blow-up is placed, so an over-cap key in the session (a poll grew a factory) simply stays closed.
  - *Opening a part.* Choosing a factory drawn inside a frame opens it at its place in the tree: the path grows by the chain
    from the level to it (`pathBelow`), so Back pops one level at a time as Decision 4 says.
  - *Expand all / Collapse all.* "Collapse all" while anything is blown up (clears the level's set); otherwise "Expand all"
    blows up what fits, the level's cards first and then their parts, one round per depth, disabled when nothing fits.
  - *Keyboard.* The hidden "Expand <name> in place into its N factories" button (in "Open and close parts of the graph"),
    `aria-disabled` with the tooltip's words past the cap; focus then goes to the frame's first part in tab order. Escape on
    a part's button collapses its frame and returns focus to the card; the frame's hidden "Collapse ..." button does the same.
  - *Nested frames' tabs.* dagre leaves a nested compound node too close under its parent's top for both header tabs, so
    `roomForNestedTabs` (`layoutSite.ts`) grows the parent upward by the difference, and a scene with nested frames gets
    `FRAME_HEADER_H` more top margin.

### 6. Editing: every change is one replace

- New operations in `designationOps.ts`: **Group** (pick factories with the Select tool, then "Group into a new factory"),
  **Ungroup** (dissolve a parent; its children and own members go to its parent, or become top level), **Move** (change
  `parentId`). Picked automatic factories are designated in the same replace (owner answer 3). Intents `group`, `ungroup` and
  `move` join `KNOWN_PLANNER_DESIGNATIONS_REPLACE_INTENTS` (additive).
- Merge offers only siblings (same parent); across parents the button says why, in text. Undo is the existing inverse replace.
- Deleting a parent's last child leaves the parent if it owns machines; otherwise it is deleted in the same replace.
- **Note (2026-10-28, build PR 2).** The single `DELETE .../:designationId` follows the same two rules on the server, in one
  transaction: a deleted designation's children move up to its own parent (as Ungroup), and an ancestor left with no members
  and no children is deleted too, up the tree. Its response stays `{ deleted: true }`; a client re-reads the list. A
  **replace** does neither for the client: one that would leave a parent empty is 409 `designation_shape`, and one that
  removes a parent while a designation outside `expect` still names it is 409 `designation_stale` (the client missed a child).
  The write order (inserts parents first, then updates in place, then deletes) keeps the `ON DELETE RESTRICT` key whole.
  Re-parenting is a write to each child (revision + 1), so a client holding the old revision gets `designation_stale` and
  re-reads. An empty childless parent the previous build left (it ignores `parent_id`) never blocks an unrelated write.

### 7. Persistent state and the flag

- One nullable column `parent_id` on the designations table, a self-referencing foreign key with `ON DELETE RESTRICT`, by an
  additive migration. New persistent state and a new fact the graph builder reads, hence an ADR.
- Feature flag `planner.nesting` in `plannerPrefs.ts`, off by default until the owner reviews it on the demo, as ADR-0060 did.

## Contracts

All in `packages/shared/src/plannerDesignations.ts` unless said otherwise. **Additive** (ADR-0007): an older client ignores
`parentId`.

1. `PlannerDesignationSchema` gains `parentId: z.uuid().nullable().optional()` (absent means top level, or an older backend).
2. Create and replace `put` entries accept an optional `parentId`. `PUT` (update) does not change it; Move goes through replace.
3. `members` may be empty **only** on a designation with children. Create and `put` loosen `.min(1)` to `.min(0)`; the route
   enforces "members or children" with 409 `designation_shape`. This is the one loosening, called out in its PR.
4. `PLANNER_DESIGNATION_MAX_DEPTH = 3`. New 409 codes: `designation_cycle`, `designation_depth`, `designation_shape`. A
   `parentId` naming a missing designation is `designation_stale`.
5. `packages/shared/src/productionGraph.ts`: `PlannerFactory` gains optional `parentDesignationId` so a client without the
   designation list (a viewer) can still build the tree. Optional, additive.

Each numbered contract change ships in build PR 1 (one contract PR, nothing else in it).

## Build plan (each PR from `main`, no stacking)

| # | PR | Files | Proof |
|---|---|---|---|
| 1 | Contract | `plannerDesignations.ts`, `productionGraph.ts` (shared), their tests, header comments | Old payloads parse; empty members only with children |
| 2 | Backend | migration, designation routes, graph builder passes `parentDesignationId`, error codes | Route tests per code: cycle, depth, shape, concurrent delete; matching unchanged |
| 3 | Tree and path | `factoryTree.ts`, `overviewScene(path)`, `PlannerView.tsx` (`getAll`), breadcrumb, `PlannerPanel` | Roll-up tests; a #776 link works; Back pops one; a bad tail is trimmed with a note |
| 4 | Blow up | `canvasScene.ts`, `layoutSite.ts` (memo), `SiteGraph.tsx`, toolbar | Frame nesting; the cap; layout benchmark recorded here; keyboard and axe |
| 5 | Editing | `designationOps.ts`, Select tool wiring, undo | Group (with automatic factories), ungroup, move, undo; overlap and stale paths |
| 6 | Demo and review | demo world with a 3-level factory, e2e, baselines | `ui-reviewer`; the owner reviews; the flag is removed after |

## Consequences

- A player organises a base into areas without a second noun; the single-owner rule and matching are unchanged.
- The overview shows an area as one card or as its parts, in place or by opening it; #776's links stay valid.
- A parent's outputs are derived, so they can read "at least" where internal flows are estimated.
- Depth 3 and the 120-card cap keep dagre inside the 100 ms budget; both are constants, not schema.

## Revisit when

- Players want depth beyond 3.
- The expanded layout passes 100 ms on a real save (pull in ADR-0050's worker step).
- The backend needs the roll-up itself (for example an alert on a parent); `productionGraph.ts` then grows the tree.

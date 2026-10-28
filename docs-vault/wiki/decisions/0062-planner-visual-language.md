# ADR-0062: Planner visual language and text path (destination caps, stalled marks, an outline instead of tables) and the Factory page

Status: **Accepted** (owner, 2026-10-27), with the owner's answers below. Proposed the same day from an independent
`architecture-advisor` review of `main`. Amends ADR-0050 Decision 4 (the text form) and ADR-0053. Paths are relative to
`frontend/src/` unless they say otherwise. The owner's words: "Instead of '1 flow to storage' ... use an animation or other design
language", "Instead of text 'backed up' use some kind of design language element ... (and be toggleable)", "Tables seems
unhelpful", "The factory tab feels difficult to use and is a bit unwieldy to look at". **Amended 2026-10-27 (accepted, owner):
every line shows its rate; see "Amendment, 2026-10-27" at the end.**

## Owner answers (2026-10-27)

1. **Stalled display.** Marks by default, with a toggle back to words. Words always stay in the text path.
2. **Destination caps.** The animation's speed **shows the rate** (not a constant speed). Decision 1 below says how, without
   overstating what is known.
3. **Tables.** Build the outline (needs attention first, then factories and groups as sentences with clickable neighbours), with a
   5-column "All connections" table behind a disclosure. The old tables are removed after the owner reviews the outline on the demo.
4. **Factory page.** Build all five proposals in section F, each as its own PR after the Planner work.

## Context

- **Destination chips (C).** `destinationChipText` makes "3 flows to storage" / "1 flow to the Depot" from `CHIP_WORD`
  (`planner/plannerText.ts:265-275`). It feeds the factory detail chips (`planner/FactoryParts.tsx:8,65`), a card's accessible
  description (`planner/graph/canvasScene.ts:478`) and a site card's storage count (`canvasScene.ts:639`).
- **Stalled state (D).** `outputLine` writes "Iron Ingot: 0 of 120 items/min · backed up" with `stalledStateText`, which returns the
  one state all of a group's machines share, else "not producing" (`plannerText.ts:50-71`). A factory card shows it as a muted note
  (`canvasScene.ts:468`).
- **Tables (E).** `PlannerTables.tsx` has a groups table of up to 9 columns and a connections table of 7
  (`PlannerTables.tsx:208-219, 259-270`). Below 640 px these tables are the whole planner. `frontend/CLAUDE.md` requires a keyboard
  and text path to every canvas's data, so the tables can only go once something else is that path.
- **What to build on.** Item bubbles and the `planner.itemFocus` flag (ADR-0060); state colours `--color-warn`, `--color-bad` and
  their variants (`index.css:37-42, 86-87`); motion tokens zeroed under reduced motion (`index.css:160-164, 432-442`); `motionOn`
  (`SiteGraph.tsx`); the `sr-only` DOM layer; `buildingIcons.ts`; CSP `style-src 'self'` (`public/_headers:6`).
- **The rule for all three.** The canvas may get symbols; the words never go away. They stay in `<title>`, `aria-label`, the live
  region and the outline. A symbol is never the only carrier, and colour is never the only difference between two symbols.

## Decisions

### 1. Destination caps replace the chips on the canvas (C)

- **Shape.** A card's footer row shows one **cap** per destination kind: a short arrow stub ending in a 20-unit disc holding the
  destination's glyph (storage, Depot, Sink, power, station, unknown "?"). More than one flow adds a number badge ("3"). The kinds
  are the keys of `CHIP_WORD`. Art from `buildingIcons.ts` where it has a slug, else an inline glyph; colours from tokens only.
- **Animation and rate (owner answer 2).** The stub's dashes travel toward the disc. The speed is one of three steps, each a token
  (`--duration-flow-slow`, `--duration-flow-mid`, `--duration-flow-fast`), chosen from the cap's summed rate against fixed
  thresholds (constants beside the component, in items or m³ per minute). Steps, not a continuous speed, so small differences are
  not read as meaningful.
  - A **measured** rate moves at its step. An **estimated** rate moves at its step with a dashed stub, as estimated lines are drawn
    (ADR-0050 Decision 2). An **unknown** rate does not move: a static dotted stub.
  - A **stalled** flow (Decision 2) does not move, whatever its rate.
  - The rate and its quality are in the cap's `<title>` ("about 120 items/min to storage"), so the speed is never the only carrier.
- **Motion.** CSS classes drive the dash offset; no `style=`, no JS timer. The three tokens are zeroed under reduced motion like the
  rest, and the Motion control (Off) stops them.
- **Layout.** The footer row sits inside the card (one fixed row taller), so dagre and the router are unchanged and the 100 ms
  budget is untouched. More than 4 kinds collapse into a "+k" cap that opens the detail panel, which still lists every destination.
- **Text path.** `destinationChipText` stays for `description`, `<title>` and the outline. Each cap is a button in the DOM layer
  (roving tabindex, like the bubbles) that focuses the card's detail.
- Rejected: dots moving along the real routed lines (per-line animation on 200 edges costs frames).

### 2. Stalled marks replace "backed up" on the canvas, with a toggle (D)

- **Source.** Derived on the client from the group's `stateCounts` (the input of `stalledStateText`); no new data. `CanvasFlow` (a
  frontend type) gains `stalled?: "backedUp" | "underfed" | "paused" | "idle"`.
- **One component, `StateMark`, in three places:**
  - **Line:** a stalled line ends in a stop bar instead of an arrowhead and does not animate.
  - **Item bubble** (ADR-0060): a ring in the state's colour plus a corner glyph (stop bar for backed up, half ring for underfed,
    pause bars for paused, dash for idle). The shapes differ, so it reads without colour.
  - **Card product line:** the glyph replaces the "· backed up" suffix.
- **Tokens (owner decision 2026-10-27, "amber").** `--color-warn` (amber) for backed up and underfed, `--color-info` for paused,
  `--color-muted` for idle: each state's tone in `factory/machineState.ts`, consistent with ADR-0041 (red only for failure) and
  with `machineState.ts` ("backed up ... a warning, never bad"). At least 3:1 against the card (WCAG 1.4.11). No new state token.
- **Toggle (owner answer 1).** `planner.stateStyle`: `"marks"` (default) or `"words"`, in `plannerPrefs.ts` (validated; works
  without localStorage). Words mode draws today's canvas text and no marks. One toolbar control.
- **Never toggled off:** `<title>`, `aria-label`, the live region and the outline always carry the words.
- Rejected: colouring the whole card (backed up is information, not an alarm: `factory/FactoryPanel.tsx:19`).

### 3. The outline replaces the two tables (E)

- **Why the tables fail** (from the code): up to 9 columns for what is one sentence; groups and connections in two tables, so
  following a flow means matching names across them; no order by importance; actions mixed into data columns; on a phone the
  table is the whole planner.
- **Shape (owner answer 3).** One `PlannerOutline`, a nested list (`ul`/`li`, headings, disclosure buttons; not an ARIA tree):
  1. A summary sentence (machines, stalled, in loops).
  2. **Needs attention:** stalled outputs, bottlenecks and unknown ends, by severity; each with "Show in graph".
  3. **The tree:** factories (with ADR-0061, parents too), then groups. Each group is a sentence: "12 Smelters make Iron Ingot: 0
     of 120 items/min, backed up. Gets Iron Ore from Miners (60/min). Sends Iron Ingot to Constructors (30/min)." Each neighbour
     is a button that moves to its row, so a flow is followed by keyboard without a second table.
  4. Row actions (Pop out, Select, Split) as buttons in the row, unchanged in behaviour (ADR-0055 Decision 12).
- **Graph sync.** Selecting a card moves focus and scroll to its row; "Show in graph" sets the selection. One shared selection.
- **All connections.** One table behind a disclosure, 5 columns (From, To, Item, Rate, Carrier) with `aria-sort` headers. Capacity
  and Flow move into a row's detail. The groups table goes.
- **Cost.** DOM only; factories over 20 groups start closed. Virtualise only if a measured render passes 50 ms
  **[NEEDS MEASUREMENT]**.
- **Accessibility.** Headings in order, `aria-expanded` on disclosures, `aria-current` on the row matching the graph selection, the
  `StateMark` always followed by its word. Axe and a keyboard-only e2e in build PR 4.

### 4. No contract change, no new dependency

`packages/shared` does not change. New code is frontend only: `StateMark`, `DestinationCaps`, `PlannerOutline`, the motion and any
state tokens, two preference keys. dagre stays a lazy chunk.

## F. The Factory page (owner answer 4: build all five)

Read from `factory/FactoryView.tsx:35-87` and `factory/FactoryPanel.tsx:56-89`, from the code, not a usability test.

**Findings.** One long page of four stacked sections; the most actionable one, bottlenecks, comes last (`FactoryView.tsx:84`), placed
there for the layout-shift budget (ADR-0032), not for use. The machine table is one flat list (Machine, Recipe, Inputs, Outputs, State)
unrelated to the factories and groups the Planner shows: 385 rows on a 385-machine site. State is a word per row plus a total, with no
filter but text search. The two pages describe the same machines in different terms.

**Build, each its own PR:**

1. A compact bottlenecks summary first, in a reserved-height box (keeps the shift budget); the full list stays below.
2. The machine table grouped by Planner factory and group, collapsible with counts, sharing `PlannerOutline`'s tree component.
3. `StateMark` for state, and the summary counts as filter toggles (a `?state=` deep link, like `?q=` and `?item=`).
4. A sticky filter bar and an in-page nav (Machines, History, Bottlenecks) on the hash the page already honours (`#history`).
5. A capped first render (50 rows per group, then "Show all"), so the page height is bounded.

Proposals 2 and 3 come after build PRs 1 and 4 below.

**Interim scope of item 5 (2026-10-28).** Item 5 is built before item 2, so until the table is grouped it is one group: the
filtered and searched list shows its first `FACTORY_ROW_CAP` (50) machines, then "Showing 50 of N machines" and "Show all N
machines" under it (`factory/useRowCap.ts`, `factory/ShowAllRows.tsx`). The cap applies after the filter and search, so a search
(or a `?q=` link) reaches any machine. "Show all" moves focus to the first newly shown row; changing the filter or search caps the
list again, while the 30 s poll keeps it open. The phone's cards are the same table, so the same cap. Item 2 calls `useRowCap` once
per group.

## Build plan (each PR from `main`, no stacking)

| # | PR | Files | Proof |
|---|---|---|---|
| 1 | Tokens and `StateMark` | `index.css` (flow and state tokens), `StateMark.tsx`, `stalledOf`, tests | Contrast in the theme; reduced motion zeroes the tokens; no visible change yet |
| 2 | Stalled marks and toggle | `canvasScene.ts` (`stalled`), `SiteGraph.tsx` (stop bar, bubble ring), `plannerPrefs.ts`, toolbar | Words unchanged in `<title>` and aria; words mode reproduces today's canvas; baselines |
| 3 | Destination caps | `DestinationCaps.tsx`, card footer row, `layoutSite.ts` card height, DOM-layer buttons | Speed steps by rate and quality; unknown and stalled static; layout time unchanged; reduced motion |
| 4 | Outline | `PlannerOutline.tsx`, `PlannerPanel.tsx`, selection sync, the 5-column table behind a disclosure | Axe; keyboard-only flow; the phone view; old tests ported |
| 5 | Remove the old tables | `PlannerTables.tsx` | After the owner reviews the outline on the demo |
| 6 | Demo and review | demo data, e2e, baselines | `ui-reviewer`; the owner reviews |
| 7-11 | Factory page F1-F5 | `factory/` | One PR each; baselines; the layout-shift budget holds |

### Values chosen in build PR 3 (caps), 2026-10-28

- **Where caps show.** An overview factory card: one cap per kind in `FactoryModel.destinations` (every flow from its groups
  whose `destination` is not `factory` or `machine`, so the same set its "N flows to ..." words count), ordered as before
  (storage, Depot, Sink, power, station, unknown, then a newer backend's word). In an opened factory with Storage detail off,
  a group or closed bubble that fills folded terminal storage gets the storage cap (the old chip; `foldStorage` now keeps the
  flows, not only their count). No caps on a site scene (an older backend has no destinations), on a fold card, or on a group
  opened into its machines. The canvas drew no chips before; the words stay where they were: `destinationChipText` in the
  card's `description` (tooltip and button), the group panel's facts and `FactoryFacts` (the phone's cards and an opened
  factory's detail). No contract change: the rates come from the flows the client already has.
- **Shape** (`layoutSite.ts`, `DestinationCaps.tsx`). A footer row `CAP_ROW_H` 28 under the card's lines (the card is that
  much taller, only when it has caps). Each cap is a stub `CAP_STUB` 14 long ending in a disc `CAP_D` 20 across, `CAP_GAP` 12
  apart (so a "99+" badge clears the next stub) from the card's left padding. The disc is `fill-icon-chip` with a
  `stroke-line` ring and the kind's art at 14: the storage container, Dimensional Depot and AWESOME Sink icons
  (`buildingIcons.ts`), the generic power and station glyphs, and the "?" glyph for an unknown end or a word this build does
  not know. The glyphs are drawn `stroke-surface` at a heavier stroke (`ui-reviewer`: the cards' default `stroke-fg` on the
  light chip is about 1.3:1; `CardIcon`'s fallback glyph on a card has the same pairing, left for its own fix). Past one flow a number badge (a 16-tall pill on the
  disc's top right, "99+" past 99). Past `CAPS_MAX` (4) kinds: the first three and a "+k" disc. The stub wears its line's
  colour and width: `stroke-muted`, `stroke-info` when every flow is a fluid, `stroke-line` when unknown; 2, 3 or 4 by step
  (`lineWidth.ts`'s widths); solid measured, `8 5` estimated, `2 5` unknown. A stalled cap in marks mode wears its state's
  tone as a 2.5 ring, like a stalled bubble; the keyboard's ring is `stroke-accent` 3.
- **Thresholds reused.** `capStep` is `rateStep` on the cap's summed rate (`sumCapRates`: ADR-0053 Decision 3's rule per
  unit, "at least" when a part has no number), so a cap and a line of the same rate move alike. A cap of items and fluid
  moves at the faster of each unit's own step (units are never compared by number). Quality: unknown (still, dotted) when no
  unit has a number, measured only when every unit is measured, else estimated. Stalled: the card's `stalled` (`stalledOf`)
  unless the flows were measured above 0, as `withStalledFlows` rules for lines; still in marks and words modes alike.
- **Layer and cap accounting.** The moving part is never in the canvas: the canvas draws every cap still, and the moving part
  is drawn in the march layer (`MarchLayer`), in a group after the lines. A measured cap keeps its solid stub in the canvas and
  the layer's pulses ride over it (invisible except while running); an estimated cap's dashed stub leaves the canvas while it
  moves and the layer draws it moving in the same place (no cover: a cover in the card's colour would not match a picked or
  dimmed card). A cap sits inside its card, which is a hole in the lines' mask, so the caps have a mask of their own whose
  only holes are the open or closing item card. **Caps do not count toward `MARCH_MAX`**: they have their own budget,
  `CAP_MARCH_MAX` = 40 (`marching.ts`, like the transport glyphs' `MAX_MOVING`), in view, fastest first then card order
  (`capCandidates`, `marchingCaps` in `capLayout.ts`), chosen from the same settled view. A cap's stub repaints a 14 by 4 box,
  a small fraction of a line's, so caps sharing the lines' 60 would only take motion from lines. The same rules as lines:
  nothing moves with Motion Off, under reduced motion (On or System), in a hidden tab, during a glide or a lasso; the
  `[data-march]` backstop applies. The Motion control also shows when only caps can move.
- **Text path.** Each cap's `<title>` is `capText`: "about 120 items/min to storage, 3 flows", "48 items/min to the Sink",
  "2 flows to power, rate unknown", a stalled one adding ", not moving: backed up"; a "+k" cap lists its kinds
  (`moreCapsText`). Each cap is a button in a list "Where the cards' flows end" after the bubbles' (one tab stop, a roving
  tabindex; arrows, Home, End), named "<card> sends <capText>"; focusing one rings its cap and brings its card into view.
  Enter, a click on its button or on the drawn cap shows the card's detail: a factory opens (its facts list every
  destination), a group's panel opens (focused, its facts list the storage), a closed bubble opens into its groups and their
  caps. Never a pick, even in Select mode.
- **Layout time** (vitest on the dev box; medians of five cold layouts, ms). The new A/B in `layoutScene.caps.test.ts`, the
  48-factory overview of `planner-caps-large` (42 lines): 5 without caps, 4 to 5 with them, every card exactly `CAP_ROW_H`
  taller, the same lines, no router failure. The existing benchmarks, whose scenes have no caps, main / this branch: ADR-0060
  overview 42.8 / 44.2-48.9, focused 42.8 / 43.3-46.0; blow-up "Expand all (to the cap)" 46 / 47-52, "one factory of 59
  groups" 29 / 29-33; `layoutScene.test.ts` "open (150 groups in 15 frames)" 195 / 195-230 (over 100 on main too). Within the
  box's run-to-run noise: no layout cost.
- **Frame times.** A new e2e test (`e2e/planner-graph.spec.ts`, "destination caps move in the march layer ...", scenario
  `planner-caps-large`: 48 factory cards, every one with one to five kinds of end, more than 100 caps) records fitted, all
  in view and Motion Off frame times as `caps-frame-times.json` and holds the lines' regression bound on desktop (fitted p95
  at most twice Off's plus 17 ms). CI's numbers **[NEEDS MEASUREMENT]**: to record from the PR's e2e run. A second test
  reaches a cap by keyboard from the cards' buttons, moves with the arrows, runs axe and opens the factory.
- **Screenshots.** A factory card with destinations grows one row, so the overview baselines with such cards change (the
  `planner-factories` cards: storage on Iron Plate, the Sink on Iron Rod), and a factory's canvas with Storage detail off.
  Screenshots run under reduced motion with animations disabled, so they show the still caps.

## Consequences

- The canvas reads at a glance by shape and motion, and the words are never lost for a screen reader or a phone.
- Cap speed encodes the rate in three steps; estimated and unknown rates look different, so motion never claims more than the data.
- The mark set is one more component and four glyphs to keep in step with `machineState.ts`.
- The outline is a new surface, and it is where ADR-0061's nested factories show as a tree in text.
- Planner tests that read table cells are ported in build PR 4.

## Revisit when

- The owner finds symbols harder to read than words (flip `planner.stateStyle`'s default).
- Animated caps on 100+ cards cost frames (animate only the hovered or focused card).
- Belt capacity reaches `CanvasFlow` (ADR-0060 Revisit): a cap could then show fullness, not just rate.

## Amendment, 2026-10-27: every line shows its rate

Status: **Accepted** (owner, 2026-10-27), with the owner's answers below. The owner's words: "one feature I eventually want is
all the lines moving based on their belt speed (or actually speed) and thickness + color also based on it. Vehicle/alternative
transport uses a different line style."

### Owner answers (2026-10-27)
1. **Colour:** "Speed + thickness only". Colour keeps its meaning of carrier and kind: pipe is info, a mixed belt is warn, an
   unknown line is the unknown style, stalled is bad or warn (Decision 2). Rate never changes colour.
2. **Moving lines:** "Lines in view, capped". The cap is set after a measurement on a factory of 200+ edges
   **[NEEDS MEASUREMENT]**.
3. **Transports:** "Double line".

### Decisions
1. **Marching dashes on every line with a rate.** Each edge with a measured or estimated rate that is not stalled has its
   dashes march (a `stroke-dashoffset` animation set by CSS class; no per-edge JS, no `style=`) at one of three speed steps.
   This narrows Decision 1's "Rejected: dots moving along the real routed lines": dashes by class, only on lines in view and
   under the cap, not dots on every edge.
   - An **unknown** rate is static and dotted. A **stalled** line is static and ends in a stop bar (Decision 2). An "at least"
     rate counts as **estimated** (dashed, and it moves at its step).
2. **One step function, shared.** `rateStep(ratePerMinute, unit)` returns slow, mid or fast. The destination caps (Decision 1)
   use the same function, so a line and its cap agree. It has fixed thresholds per unit (items/min and m³/min), and steps are
   never compared across units: a fast pipe and a fast belt are each fast for their own unit. The threshold values are set in
   build PR 1 (see "Values chosen in build PR 1" below).
3. **Motion tokens.** `--duration-flow-slow`, `--duration-flow-mid` and `--duration-flow-fast` are defined once, by whichever
   PR lands first (this one or the caps PR; they do not exist yet). They are zeroed under reduced motion like the other motion
   tokens, and the Motion control's Off stops them.
4. **Width means rate.** Line width has three steps, 2, 3 and 4, from the same `rateStep`. A mixed belt keeps its warn colour
   and gets a thin inner stroke instead of extra width, so width only ever means rate.
5. **"Speed" is throughput, not belt tier.** The step comes from items (or m³) per minute. Belt tier and fullness are
   [NEEDS VERIFICATION] until capacity reaches `CanvasFlow` (ADR-0060 Revisit); the legend says the speed is the rate, not
   the belt.
6. **Transports draw a double line.** Train, truck, drone and Depot edges draw two parallel strokes and do not march; their
   glyph moves along the line instead. The glyph's motion path skips the item bubble's label box (the bubble work in flight
   in branch `feat/planner-expand-machines`).
7. **Legend and text path.** The legend gains the speed and width rows and the double line. Each line's `<title>` and
   aria text add the step word ("about 120 items/min, fast"), so motion and width are never the only carriers.
8. **No layout change.** No dagre or router change; width and dashes are drawn on the existing routes. No contract change.

### Build plan (each PR from `main`, no stacking)
| # | PR | Proof |
|---|---|---|
| 1 | `rateStep`, per-unit thresholds, the flow tokens (if not yet added) | Unit tests per unit and edge values; reduced motion zeroes the tokens |
| 2 | Width steps and the mixed belt's inner stroke | Baselines; contrast holds |
| 3 | Marching dashes, the in-view cap, the measurement on a 200+ edge factory | Frame-time measurement recorded; unknown and stalled static; Motion Off |
| 4 | The transport double line and moving glyph | Baselines; glyph skips the bubble label |
| 5 | Legend rows and the step word in `<title>` and aria | Axe; `ui-reviewer` |

### Values chosen in build PR 1 (2026-10-27)
Build PR 1 of the ADR and of this amendment landed as one PR (both add the same tokens to `index.css`).
- **Thresholds** (`planner/graph/rateStep.ts`, named constants; at or above a threshold is the higher step). Items/min: slow
  under 120, mid 120 to under 480, fast 480 and up: a full Mk.2 belt and a full Mk.4 belt. m³/min: slow under 300, mid 300
  to under 600, fast 600 and up: a full Mk.1 pipe and a full Mk.2 pipe. The belt tiers Mk.1-4 (60, 120, 270, 480) and the
  pipe tiers Mk.1-2 (300, 600) are from `raw-sources/frm-conveyor-gchecks-2026-10-21.md`; Mk.5 and Mk.6 capacities are not
  in raw-sources [NEEDS VERIFICATION], and no threshold depends on them.
- **No step** (`null`, the line does not move): a missing, 0, negative, NaN or infinite rate, and a missing or unknown unit.
  A stalled flow is static whatever its step; that check is the caller's.
- **Durations.** `--duration-flow-slow` 2.4s, `--duration-flow-mid` 1.2s, `--duration-flow-fast` 0.6s per dash cycle (each
  step halves the last, so slow reads clearly slower), zeroed under reduced motion with the other motion tokens.
- **Mark colours.** `StateMark` takes each kind's tone from `factory/machineState.ts` (backed up and underfed `--color-warn`,
  paused `--color-info`, idle `--color-muted`), so a mark and the Factory page's word agree and no state token was added. The
  owner confirmed these on 2026-10-27 ("amber"), and Decision 2's "Tokens" line now says the same. Every tone used clears 3:1
  on the canvas, the surface and surface-2 (`StateMark.test.tsx`).
- **`stalledOf`** (`planner/plannerText.ts`) shares `stalledStateText`'s rule: a mark only when all of a group's machines share
  one of the four states. "Not producing" (mixed), "unpowered" and unknown states have no mark and keep their word.

### Values chosen in build PR 2 (2026-10-28)
- **Widths** (`planner/graph/lineWidth.ts`, named constants, the SVG `stroke-width` attribute in canvas units): slow 2, mid 3,
  fast 4, from `rateStep` on the line's `ratePerMinute` and unit. A bundle uses its summed rate, the number its label reads.
  A line with no step (unknown, 0, a stalled line reading 0) keeps the base width 2, which is today's width for every
  unmixed line, so unknown lines look as before.
- **Mixed lines.** The warn colour and the rate's width, plus an inner stroke in the canvas colour (`stroke-surface`, the
  graph's and the legend's background) drawn over it: 0.5, 1 and 1.5 for slow, mid and fast (its dashes each one unit
  shorter and centred in the line's, so a dashed or dotted line's holes close at both ends), which
  leaves a warn rail of 0.75, 1 and 1.25 on each side. Contrast: the rails are `--color-warn`, and both sides of each rail
  are surface (the canvas outside, the inner stroke inside); warn on surface and on canvas clears 3:1
  (`lineWidth.test.ts` computes it from the tokens in `index.css`). The old mixed width 3 is gone.
- **Markers.** The arrowhead stays `userSpaceOnUse` (8 long, 8 wide at its base, the same on every width). It is now placed
  at its middle (`refX` 5, was 9) and the line stops 3.2 short of the route's end (`roundedOrthogonalPath`'s `trimEnd`, with
  every corner kept), so a line ends where the head is 4 wide and a 4-wide line never blunts the tip; the tip is where it
  was, 0.8 past the end under the card. The inner stroke stops 8 short, before the head's base (7.2), or 3 short on a
  stalled line, at the stop bar's back. A trim always leaves 0.5 of the last run, so the marker keeps its direction. A
  stalled line's stop bar (12 tall) is unchanged and untrimmed: the line ends inside the bar.
- **Known limit.** A slow mixed line's warn rails (0.75) blur together below about 0.8 zoom; colour still says mixed there
  (as it did before this PR). To check on the baselines.
- **Transports** keep today's 2, or 3 when mixed, and no inner stroke, until their double line (build PR 4).
- **Legend.** The samples stay at the base width; the mixed-belt sample wears the inner stroke so it matches the canvas.
  The width rows are build PR 5's.

### Values chosen in build PR 3 (2026-10-28)
- **Which lines march** (`planner/graph/marching.ts`, `marchStep`): a belt or pipe line with a measured or estimated rate
  (an "at least" sum is estimated) whose `rateStep` is not null and that is not stalled. Unknown lines stay static and
  dotted. A stalled line stays static in marks mode (stop bar) and in words mode too, since motion would claim a flow.
  Transports do not march (their glyph is build PR 4's).
- **How a measured line marches.** Estimated already means dashed (ADR-0050 Decision 2), so a measured line never becomes
  dashed. It stays solid, and pulses ride over it: a thin stroke (half the line's width, or a mixed line's inner width, at
  least `PULSE_MIN_W` 1.25 so a slow line's beads show; `ui-reviewer`, to check live on the demo) in
  `stroke-fg-strong` at `--opacity-flow-pulse` (0.7), dashes `3 10`, trimmed before the arrowhead like the inner stroke.
  The pulses' own opacity is 0 and only their animation's keyframes make them visible, so a still frame, a screenshot with
  animations disabled and reduced motion all draw exactly today's line. An estimated line's own `8 5` dashes march; a mixed
  estimated belt's inner `7 6` dashes march with them in step (same step class, same cycle), so the warn rails and the
  hollow core stay aligned; a mixed measured belt's pulses run in its core between the rails. Rejected: a long-dash pattern
  on measured lines while they move (it reads as estimated). **Owner check:** the pulse look is a default; the owner can
  choose it against "only estimated lines march" when reviewing the demo.
- **Direction and timing.** Each path runs source to destination (the arrowhead's end), and the keyframes lower
  `stroke-dashoffset` by `--flow-dash-cycle` (13, the length of `8 5`, `7 6` and `3 10`; `marching.test.ts` keeps them
  equal) per cycle, so dashes move toward the arrowhead. The inner stroke's keyframes start at its still offset
  (`--flow-dash-inner-offset`, -0.5). One cycle lasts the step's `--duration-flow-slow|mid|fast` (2.4s, 1.2s, 0.6s),
  `linear infinite`. Classes `animate-flow-{step}`, `animate-flow-inner-{step}`, `animate-flow-pulse-{step}`, plus
  `data-march="{step}"` on every animated path.
- **Motion Off and reduced motion.** Motion Off (or a hidden tab) renders no class and no pulse path at all. Under
  `prefers-reduced-motion` the flow tokens are 0 and `[data-march] { animation: none !important }` stops the lines outright,
  on their still frame, rather than running a 0s cycle; this holds with the Motion control on "On" as well, like every
  CSS motion token. (Since the march layer fix below, reduced motion also renders no march layer at all, On or System; the
  CSS rule stays as a backstop.) The Motion control now shows whenever something can move: a transport or a line that can march (before,
  only with a transport).
- **The in-view cap.** `MARCH_MAX` = **60** lines. Candidates are listed once per layout (`marchCandidates`: fastest step
  first, then the layout's edge order, so the choice is deterministic and a poll that keeps the layout keeps it); each
  view takes, in that order, the candidates whose route's bounding box meets the stage (`isInView`, the same test the
  transport glyphs use) until the cap. Lines out of view or past the cap stay static. The view is the canvas's own pan and
  zoom state (no observers); the set is chosen from the view once it has been still for `MARCH_SETTLE_MS` (150 ms,
  `useSettled`), so a drag or pinch does no per-frame work and lines entering the view start once it settles. Why 60 before
  the measurement: a dash-offset animation is not composited, so every marching line repaints its box each frame; past a
  few dozen lines spread over the view, the damaged area is most of the canvas and more lines add little, while the
  per-path paint work keeps growing. 60 is 1.5 times the transport glyphs' `MAX_MOVING` (40), which is cheaper per item.
- **Measurement** (`e2e/planner-graph.spec.ts`, "marching dashes ... record their frame times (210 lines)", on the
  `planner-large` scenario: 160 groups and 210 lines built from the shared fixtures, the measured site's size). It records
  `requestAnimationFrame` deltas over 2 s (frames, p50, p95, max) with the lines marching at the fitted view, zoomed out so
  every line is in view, and with Motion Off, at 1440 and 390 px; it attaches them as `marching-frame-times.json` and logs
  them. It asserts more than 10 frames in 2 s, and (since the fix below) one regression bound.
- **Measured baseline: CI headless, software raster, before the fix** (Linux headless Chromium, PR #806's merge run; p50 /
  p95 in ms, lines marching in brackets):
  - 1440 px: Motion Off 16.7 / 16.8; fitted (4) 83.2 / 116.7; all in view (60) 50 / 66.7.
  - 390 px: Motion Off 16.7 / 16.7; fitted (2) 83.3 / 100; all in view (25) 33.3 / 50.1.
  The cost did not follow the number of marching lines (4 cost more than 60): a `stroke-dashoffset` animation on any path
  inside the canvas `<svg>` repainted the whole canvas every frame (all 210 lines, the cards, bubbles and labels), and the
  fitted view, at a larger scale, has more to paint.
- **The fix: a march layer** (`MarchLayer` in `SiteGraph.tsx`, 2026-10-28). The marching strokes left the canvas for a second
  `<svg>` stacked over it in the same box, with the same viewBox, fit, (transparent) border and pan and zoom transform, so each
  stroke lies on its line; it is `aria-hidden`, `pointer-events-none` and `will-change-transform`, which gives it its own
  compositing layer, and it is rendered only while something marches. The animation now invalidates only that layer, which
  holds at most `MARCH_MAX` strokes, so the per-frame cost should follow the marching lines, not the scene. The canvas draws
  every line still, always (Motion Off or not, a still frame is unchanged). The layer draws over it, per marching line: for an
  estimated line, a canvas-coloured cover (`stroke-surface`, the line's width plus 1, `MARCH_COVER_PAD`) that hides its still
  dashes, then its moving dashes (a mixed one's inner dashes in step); for a measured line, its pulses as before. The cover
  and dashes stop at the arrowhead's base (7.2 short of the end, `MARCH_TRIM`), so the canvas's arrowhead shows. The canvas
  draws its labels and cards over its lines, and the layer is over everything, so its strokes are under a luminance mask with
  a hole for every label pill, every card (with the badge and pills it centres on its top and bottom edges, and a bubble's or
  fold's pile) and the open or closing item card (`marchHoles`); nothing marches while a lasso is drawn (it is over the lines).
  Visible differences while marching, none in a still frame or a screenshot (reduced motion draws no layer): a marching line
  is drawn over every other line where they cross, and an estimated one's cover cuts a gap the line's width in the line or
  frame border it crosses. Marching now also stops under reduced motion in script, with Motion "On" as well (its CSS already
  stopped it), and during a make-room glide (the layer does not follow gliding cards). **Regression bound** in the e2e test
  (desktop only): the fitted view's p95 at most twice Motion Off's p95 plus 17 ms. Frame times come in whole vsyncs, so with
  Off at one frame (16.7) this passes at 3 frames (50) and fails at 4 (66.7); the baseline above (116.7) fails it. If the
  layer alone does not bring it under, the next levers are a `steps()` timing (a dash offset update about 15 times a second)
  and pausing the march while a pan or zoom runs.
  **Measured after the fix** (CI headless, software raster, PR #808's last e2e run, 2026-10-28; p50 / p95 / max ms over 2 s):
  - 1440 px: fitted (4 marching) 16.7 / 16.8 / 33.3; all in view (60 marching) 16.7 / 16.8 / 33.4; off 16.7 / 16.8 / 16.8
  - 390 px: fitted (2 marching) 16.7 / 16.7 / 16.8; all in view (25 marching) 16.7 / 16.8 / 16.8; off 16.7 / 16.8 / 16.8
  Every case holds one frame (60 fps) at p95, so the layer alone was enough and the `steps()` and pause levers are not
  needed. `MARCH_MAX` stays 60: by the rule below it could rise, but 60 marching lines already fill the fitted view of a
  210-line factory, and a larger cap is only worth it once a real save shows a view with more.
  Rule for the cap: if "all in view" p95 stays within a frame (about 17 ms) of "off", the cap may rise; if it passes
  33 ms, lower it (Revisit: animate only the hovered or selected path).
- **Screenshots.** Planner screenshots run under reduced motion (`e2e/states.spec.ts`) and with animations disabled, so
  the lines draw their still frame, which is today's. What changes on a canvas with no transport is the toolbar: the
  Motion control now shows there.

### Values chosen in build PR 4 (2026-10-28)
- **The double line** (`lineWidth.ts`, `lineStroke`'s `double`). A transport's line is a stroke `TRANSPORT_W` 5.5 wide in
  its line colour with a `TRANSPORT_GAP` 3 stroke in `stroke-surface` (the canvas colour) over it: two rails of
  `TRANSPORT_RAIL_W` 1.25 with a gap between them. Drawn as a "hollow" stroke rather than two offset paths: SVG has no offset
  path, and the hollow stroke follows the rounded orthogonal corners exactly. The gap's dashes are the line's own at the same
  offset (an estimated transport `8 5`, an unknown one `2 5`), so each dash is two short rails. Colour is `edgeClass` as
  before: muted (warn when mixed, `stroke-line` when unknown). Today a transport part is never mixed (`transportPart` sets
  `mixed: false`), so the warn double line is the rule for a future backend, kept by `lineStroke` (every transport, mixed or
  not, gets the same geometry). Contrast: the rails are muted or warn with surface on both sides (the canvas outside, the gap
  inside), and both clear 3:1 on surface and canvas (`lineWidth.test.ts`); an unknown transport's `stroke-line` is the
  unknown belt's colour, unchanged.
- **Unlike a mixed belt.** A mixed belt is a warn line 2 to 4 wide whose core (0.5 to 1.5) is never wider than its two rails
  together. A transport's gap (3) is more than twice a rail and at least twice any mixed core, and its footprint (5.5) is past
  every width step (4), so the two never share proportions; a non-mixed transport is also muted, not warn, and carries its
  glyph. `lineWidth.test.ts` keeps these inequalities.
- **Spacing does not follow the rate.** Decision 4's "width means rate" is for belts and pipes. A transport's rate is an
  average over trips, its glyph already says "a vehicle carries this", and a gap that grew with the rate would make the double
  line's footprint (or its rails) read as one of the belt widths. So one fixed geometry for every transport; the rate is in
  the label, the `<title>` and (build PR 5) the step word. **Owner check:** stepping the gap by rate is the alternative.
- **The arrowhead.** The double line stops `DOUBLE_UNDER_ARROW` 4.8 short of its route's end (a belt's 3.2), where the head
  (8 long, 8 wide at its base, tip 0.8 past the end) is 5.6 wide, so the rails never stick out beside it. The gap stops 8
  short as a mixed line's core does, so the rails close against the head's base; a stalled transport's line ends inside its
  stop bar (12 tall), its gap 3 short.
- **The moving glyph leaves the canvas.** Before, a moving glyph was an SVG `animateMotion` inside the canvas `<svg>`, which
  repaints the whole canvas every frame, as a marching dash did before #808. It now rides its line in `MarchLayer`: a
  `[data-march-glyphs]` group after the marching lines, under the lines' mask (every label pill and card a hole, so the glyph
  passes under them as it passed under the cards before). Its path is unchanged: `motionPathAround`, the route minus its own
  label box grown by the halo, so it still leaps the item bubbles. The canvas draws the glyph at rest in its pill only when it
  does not move, so each glyph shows once and a still frame (Motion Off, reduced motion under System, a screenshot) is
  today's. Not measured inside the canvas first: #808's measurement (one frame to seven with 4 animated paths) applies to any
  SMIL or CSS animation there, so the move was made up front and the e2e test holds the bound.
- **Which glyphs move** (`glyphMotion.ts`). `glyphCandidates` per layout and state style: every transport edge with a route
  outside its own label box, but not a stalled one in marks mode (unchanged). `movingGlyphs` per settled view
  (`MARCH_SETTLE_MS`, as the lines): in view, edge order, at most `GLYPH_MOVE_MAX` 40 (was `MAX_MOVING`, unchanged). They
  never move with Motion Off, in a hidden tab, during a make-room glide (new: the layer does not follow gliding cards) or a
  lasso (new: it is drawn over the lines). Unlike the lines, Motion "On" still moves them under reduced motion, as ADR-0055 PR
  8b decided; System follows the setting. One trip lasts the line's length over 40 units a second, 4 to 16 s (unchanged).
- **Frame times.** A new e2e test (`e2e/planner-graph.spec.ts`, "transport glyphs move in the march layer ...", scenario
  `planner-transports-large`: the caps' 48-factory overview plus 48 transports of every mode and rate quality, more than the
  cap) records fitted, all in view and Motion Off frame times as `transport-frame-times.json` with glyphs, lines and caps all
  moving, and holds the lines' regression bound on desktop (fitted p95 at most twice Off's plus 17 ms). CI's numbers
  **[NEEDS MEASUREMENT]**: to record from the PR's e2e run.
- **Legend.** Unchanged: it shows each mode's glyph, no transport line sample (build PR 5 adds the double line's row).
- **Screenshots.** Every canvas with a transport changes its line: `planner-factory-transports` (the four modes) and any
  baseline that shows the opened Iron Plate factory with the fixture's train (`planner-factory-canvas` and the other
  `planner-factory-*` and designation states drawn inside it). The overview draws no transport (the train stays inside one
  factory). Screenshots run under reduced motion, so the glyphs stand at rest in their pills as before.

### Consequences
- The graph reads rate at a glance by speed and width, with colour left free for carrier and state.
- Animation cost is bounded by the view and the cap, not the factory's size, once the cap is measured.
- Lines and caps share one step function, so they cannot disagree.

### Revisit when
- The measurement shows the cap is too low to be useful (fall back to animating only the hovered or selected path).
- Belt capacity reaches `CanvasFlow`: width or a fill could then show fullness against the belt tier.

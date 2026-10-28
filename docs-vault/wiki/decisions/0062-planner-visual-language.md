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

### Consequences
- The graph reads rate at a glance by speed and width, with colour left free for carrier and state.
- Animation cost is bounded by the view and the cap, not the factory's size, once the cap is measured.
- Lines and caps share one step function, so they cannot disagree.

### Revisit when
- The measurement shows the cap is too low to be useful (fall back to animating only the hovered or selected path).
- Belt capacity reaches `CanvasFlow`: width or a fill could then show fullness against the belt tier.

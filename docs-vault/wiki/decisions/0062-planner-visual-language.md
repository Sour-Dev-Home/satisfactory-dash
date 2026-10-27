# ADR-0062: Planner visual language and text path (destination caps, stalled marks, an outline instead of tables) and the Factory page

Status: **Accepted** (owner, 2026-10-27), with the owner's answers below. Proposed the same day from an independent
`architecture-advisor` review of `main`. Amends ADR-0050 Decision 4 (the text form) and ADR-0053. Paths are relative to
`frontend/src/` unless they say otherwise. The owner's words: "Instead of '1 flow to storage' ... use an animation or other design
language", "Instead of text 'backed up' use some kind of design language element ... (and be toggleable)", "Tables seems
unhelpful", "The factory tab feels difficult to use and is a bit unwieldy to look at".

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
- **Tokens.** `--color-bad` for backed up, `--color-warn` for underfed and paused; at least 3:1 against the card (WCAG 1.4.11). Any
  new token is added to `@theme` in build PR 1.
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

# ADR-0063: Planner item ports on the card edges, a rate label at each end of a line, and dimming outside the focus (amends ADR-0059, ADR-0060 and ADR-0062)

Status: **Accepted** (owner, 2026-11-01): the owner approved the direction and the picks quoted below in the session of
2026-11-01. The questions under "Open questions" are still the owner's; each has a recommended answer, and the build
plan says which PR waits for which answer. Paths are relative to `frontend/src/planner/graph/` unless they say otherwise.
Docs only: nothing here is built yet. No contract change.

## Owner input (2026-11-01)

The owner looked at reference screenshots of another tool's production graph and picked three patterns for the
Planner (described here in our own words; no image is committed):

1. **Ports.** "Each card shows one small item-icon circle per input item on its left edge and per output item on its
   right edge; a line attaches to the port of its item, so which item goes in or out where is visible without reading."
2. **A label at each end of a line.** "Item name and rate, next to the port the line leaves and next to the port it
   enters, so a long line reads at either end and its middle stays clear."
3. **Dimming.** "What lies outside the current focus (e.g. raw inputs from outside the factory, or everything not on a
   selected path) is drawn dimmed with grey lines, so the main flow stands out; the final product / destination can be
   emphasised."

Two more picks the same day:

4. **The known weakness.** When two cards are close, the two end labels of one line collide. The owner accepted the
   recommendation that **the middle bubble (ADR-0060) stays as the fallback** for lines too short for two end labels.
5. **On hold:** free dragging of cards with saved positions, and routing lines around cards. Recorded under "Not
   decided / later"; not designed here.

## Context

What the code on `main` (after #827) does today, and what the design builds on:

- **Line ends.** The router starts and ends every line on a card's left or right side. `routeOrthogonal` picks the side
  from the next column (`orthogonalRoute.ts:147-152`), then spreads all ends on one side evenly down the card, ordered by
  where each line goes next (`orthogonalRoute.ts:145-172`). ADR-0059 Decision 1 says so: "several ends on one side spread
  evenly (no ports otherwise)". So an end's height says nothing about its item today.
- **Return flows.** Loops are broken before dagre (`returnFlows`, `layoutSite.ts:410`), and a return flow's route is turned
  back after. Its source end is on the source card's **left** side and its target end on the target's **right** side
  (the side rule above), the opposite of every other line.
- **One line per card pair.** `bundleFlows` (`canvasScene.ts:325`) draws all links between two cards, in one direction, on
  one carrier, of one kind and unit as one line (ADR-0059 amendment, 2026-10-27). One line can carry several items; its
  identity `edgeKeyOf` (`bubbleRow.ts:64`) has no item in it.
- **The middle bubble.** dagre reserves a label box per line (`layoutSite.ts:503`, and the merged stack's box at `:497`), the
  router forces the line through it, and the box draws the item bubbles: up to `BUBBLE_MAX` 3 items of `BUBBLE_D` 40,
  then a "+k" chip, with the rate text under them (`bubbleRow.ts:8-18`, `bubbleRowSize` in `layoutSite.ts:259`). It is
  also the item-focus target (ADR-0060), the morph's origin and the transport glyph's rest place (`glyphRestCentre`).
- **What sits on a card's edges.** The count badge is centred on the top edge; the upstream pill sits at the bottom left
  (`UpstreamPill` in `SiteGraph.tsx`, `translate(8 ...)`) and the Expand pill at the bottom right (`SiteGraph.tsx:2322`), each with a
  `PILL_HIT` 44 touch target centred on the bottom edge (`layoutSite.ts:200`). Destination caps are a footer row inside the
  card (`CAP_ROW_H` 28, ADR-0062 Decision 1). The left and right edges hold nothing but line ends.
- **Card heights.** `cardSize` (`layoutSite.ts:170-195`) sizes a card from its icon row, lines, caps and pills. On the
  overview every factory card takes the tallest factory card's height, so a row reads evenly (`layoutSite.ts:689-692`).
- **Dimming.** Two states dim today, both with one rule, `lit` and `edgeLit` (`SiteGraph.tsx:1111-1113`): the item filter
  (`reachFor` in `graphModel.ts`, everything that carries the item upstream and downstream) and item focus (ADR-0060,
  hop-1). Dimmed cards, lines and labels take `opacity-graph-dim`, `--opacity-graph-dim: 0.25` (`frontend/src/index.css:148`),
  on the whole group (`SiteGraph.tsx:1778` for a line). At a quarter opacity, a card's text and a label's words fall well
  under WCAG 1.4.3's 4.5:1 (the text tokens are `--color-fg` #ece7dc and `--color-muted` #a3a9ae on `--color-canvas`
  #17191c and `--color-surface` #1f2226, `index.css:21-30`).
- **What "outside the factory" is.** An opened factory draws only flows with both ends inside it (`factoryScene`,
  `canvasScene.ts:897`). Its inputs from elsewhere are its own groups that stand outside its home site: `remoteInfo`
  (`hierarchy.ts:449`) lists them with their site and distance, and the card says so in its facts. Shared groups say their
  split (`shareSplit`).
- **Motion and its budgets.** Marching dashes, caps and transport glyphs move only in `MarchLayer`, a second `<svg>` over
  the canvas, at most `MARCH_MAX` 60 lines, `CAP_MARCH_MAX` 40 caps and `GLYPH_MOVE_MAX` 40 glyphs in the settled view
  (`marching.ts:18,25,42`), with a luminance mask whose holes are every label box and card (`marchHoles`,
  `marching.ts:141`). The e2e regression bound is "fitted p95 at most twice Motion Off's plus 17 ms" (ADR-0062 amendment,
  build PR 3).
- **Layout budget.** 100 ms per layout (ADR-0050 Decision 3). Measured: the synthetic 160-group, 204-edge site 45-48 ms
  (ADR-0060 Decision 3), Expand all at the cap of 60 cards 53-76 ms (ADR-0061 Decision 5's note), which is why
  `EXPAND_MAX_CARDS` is 60 (`canvasScene.ts:144`).
- **Text path.** The canvas `<svg>` is `role="img"`; its keyboard path is the `sr-only` DOM layer (card buttons, the
  bubbles' one roving tab stop `bubbleStops` in `bubbleRow.ts:120`, the caps' one tab stop), and the outline (ADR-0062
  Decision 3) is the whole text form.

## Decisions

### 1. Ports: one per item per card side, drawn by the layout's own geometry

**Which items get a port.** A port is a card's end of the lines of one item on one side. It is derived from the lines
drawn in the scene, not from a node's recipe, so every card kind follows the same rule:

| Card or thing | Ports |
|---|---|
| Group card (machines, extractor, storage, buffer, Depot, Sink, power: every `role`) | One left port per item its lines bring in, one right port per item its lines take out. An extractor has only right ports, a Sink only left ones. |
| Bubble card (a closed recipe tree) and fold card ("N more trees") | The same rule over the lines drawn to and from them. |
| Factory card on the overview, a parent's roll-up card, an own-machines card | The same rule over the aggregated lines (`aggregateFlows` at the shown owner, ADR-0061 Decision 3). |
| A group opened into its machines (one card to dagre, lines join the frame) | Ports on the frame's left and right edges; the frame grows to fit them as `cardSize` grows a card (`machineFrameSize` gives the least size). The machine cards inside have none. |
| A bubble's frame, a blow-up frame (ADR-0061 Decision 5) | None: their lines go to the cards inside them, which have ports. |
| Transport lines (train, truck, drone, Depot) | Attach to their item's port like a belt or pipe. A port is per item, not per carrier, so a belt and a train bringing the same item share one port. |
| Destination caps (ADR-0062 Decision 1) | Not ports, and unchanged: they stay in the footer row, one per kind of end that no line is drawn to. An item that leaves only to a cap gets no port. |
| Lines of no known item | Share one "?" port per side (as they share one "?" bubble today). |

**One line per item.** A port is per item, so a line must carry one item. With ports on, `bundleFlows`' key gains the
item (the `BubbleItem` key, `c:<class>` or `n:<name>`, `bubbleRow.ts`), and so does `edgeKeyOf`, so focus keeps finding
its line. Links of the same item between the same two cards on the same carrier, kind and unit still bundle into one
line; links of no known item still share one "?" line. This **amends the ADR-0059 amendment of 2026-10-27**: one line per
card pair becomes one line per card pair and item. Nothing is dropped: `LaidEdge.parts` and the outline keep a row per
link as before. The cost is more lines where two cards exchange several items, mostly on the overview; build PR 2
measures it (Decision 5).

**Mixed links.** A mixed link (`CanvasFlow.mixed`: a belt whose pass-through component several producers feed) keeps
the item the backend inferred for it (ADR-0050 Decision 2), so it attaches to that item's port; one with no inferred item
goes to the "?" port. "Mixed" stays in the line's style (the warn rails, ADR-0062 amendment Decision 4), its `<title>` and
its button's name, not in the end label (Decision 2).

**Return flows.** A return flow keeps the sides the router gives it today: it leaves its source's left edge and enters its
target's right edge. Its ends get ports on those sides, drawn like the others and ordered after them on that edge, with
`<title>` words that say "comes back to" or "returns from". Routing a loop round the cards into the left input port is
"routing lines around cards", which is on hold (owner pick 5).

**Sides are an input to the router.** Which side an end is on is decided once, by the port model, before layout: a
forward line out of the source's right and into the target's left, a return flow (`returnFlows`) the other way round.
The router takes those sides with each edge (`RouteEdge` gains `srcSide` and `tgtSide`) instead of deriving them from
columns after placement (`orthogonalRoute.ts:147-152`), so the sides a card was sized for and the sides drawn can never
disagree (the column rule can flip a side when two ends snap into one column, in the merged fallback or a frame).

**Order on an edge.** Which ports a side has, and which fold (below), is known before layout. Their order is chosen by
the router after placement: ports sorted by the mean of their lines' `toward` (the next level's height,
`orthogonalRoute.ts:159-164`), then by summed rate (descending), then by name. That keeps the crossings dagre's order
gives, and a poll that keeps the placement (the layout memo) keeps the order.

**Spacing and size** (named constants in `layoutSite.ts`; tokens for colour only, as today):

- `PORT_D` 20: the disc, centred on the card's edge (half outside), the same size as a cap's disc (`CAP_D`). The icon
  inside is 16, from the 32 px item file (64 px once that would stretch, as `bubbleDetail` rules for bubbles); the name's
  initials or "?" when there is no icon, never blank (ADR-0060 Decision 6).
- `PORT_PITCH` 48: one port per 48 units down the edge, from the inequality `PORT_PITCH ≥ 2 × LABEL_LINE_H + TRANSPORT_W
  + 2 × END_LABEL_ROW_GAP + END_LABEL_CLEAR` = 2 × 16 + 6 + 2 × 3 + 4 = 48: two label rows round the widest line (a
  transport's 6), a 3 gap between each row and its line, and 4 between one port's rate row and the next port's name row.
  A unit test in build PR 3 keeps the inequality, as `lineWidth.test.ts` keeps its own.
- `PORT_INSET` = `PILL_HIT / 2 + PORT_D / 2` (32): a port's centre keeps this far from the card's top and bottom edges,
  so no disc meets the count badge or a pill's 44-high touch target (22 into the card), and ports stay above the caps'
  footer row.
- Ports on an edge are centred on it. A card grows to fit its ports (`cardSize`): its height is at least the larger side's
  ports times `PORT_PITCH` plus the insets. On the overview the peer rule (one height for every factory card) uses the
  cards' heights without port growth, so one card with many ports does not make every card tall.

**Past a cap.** `PORTS_MAX` 6 per edge: the 5 items of highest summed rate (then name) get their own port and the rest
fold into one "+N" port (N the number of items in it). The lines of folded items attach to the "+N" port, and its
`<title>` lists the items. Its end label reads "+N items" and a rate only when every folded item shares one unit (summed
per unit as `sumCapRates` does; items and m³ are never added); its lines count as having a fitting label at that end
(Decision 2), and a click on it opens the port-line list grouped by item. The fold is per side and per card; the other
end of each such line keeps its own port. The
card's description and the group panel already list every input and output, so nothing is reachable only through the
"+N" port.

**Not a target.** A port is part of its card: a click on it is a click on the card (it sits inside the card's `<g>`), and
it adds no focusable element (Decision 4). Its `<title>` gives "Iron Plate in, 120 items/min" for pointer hover. So
`PILL_HIT` and WCAG 2.5.8 apply to the card as today, not to the port.

**Arrowheads.** A line that ends at a left input port drops its arrowhead: the port's side says the direction (in on the
left, out on the right), and marching dashes say it when moving. A return line keeps its arrowhead, since its sides are
the other way round. A line into a port ends at the disc's edge (`PORT_D / 2` short of the route's end), and the trims of
ADR-0062 amendment build PR 2 and 3 (the inner stroke's, a transport's gap, `MARCH_TRIM`) are measured from there, so no
stroke runs under the port's icon; a stalled line's stop bar (ADR-0062 Decision 2) stands at the disc's edge. This amends
ADR-0062 amendment build PR 2's marker values for lines with ports (open question 5). Build PR 2 draws both behind the
flag, and the owner's answer picks which one it uses.

**dagre and the router.**

- dagre is unchanged and knows nothing of ports: it sees taller cards and, for end labels, wider boxes (Decision 2). It
  has no port constraints, and we do not add a second layout engine (ADR-0059 declined ELK).
- The router takes the sides as input (above), and an end's height comes from its port, not from the even spread
  (`orthogonalRoute.ts:162-172`). All the lines of one port leave or enter at the port's centre and share their first
  leg until their tracks part. The straightening pass's `free` test ignores levels of lines on the same port (they are
  meant to coincide), so a fan-out still straightens, and `orderTracks` breaks the ties that equal end heights now make
  by the far end's height, then edge order. A unit test covers a fan-out from one port. End-label bands (Decision 2)
  are the router's other change.
- Crossings: ADR-0059's metrics test on the synthetic dense scenes (no edge through a card, no label on another line,
  crossings no worse than measured) runs with ports on in build PR 2; ports must not add more than 10% crossings there,
  else the order rule above is revisited before the flag can be removed.
- The merged fallback uses the same ports. The grid fallback (no routes) draws ports but no end labels.

### 2. End labels, and the middle bubble as the fallback

**What a label says.** One label per port, beside it, outside the card: the item's name on a row above the line and its
rate on a row below it.

- The name is cut at `END_LABEL_NAME_CHARS` 16 with the character-width estimate; the full name is in the label's
  `<title>`.
- The rate uses the existing words, `aggregateRateText` (`plannerText.ts`): measured plain ("120 items/min"), "about"
  for estimated, "at least" for a sum with a part missing, "unknown" with no number (ADR-0050 Decision 2, ADR-0053
  Decision 3). A reading of 0 on a stalled line reads as the label does today.
- The step word (ADR-0062 amendment Decision 7) is **not drawn**: width and motion show the step on the canvas, and the
  word stays where it is today, in the line's `<title>` and its button's name (`flowTitle`, `bubbleName`). "Mixed" and
  "excess" also stay in those words and the line's style, to keep the label short.
- A port with one line reads that line's rate at both ends. A port with several lines (one item fanning out to three
  groups, or three sources into one port) reads its summed rate, and each far end reads its own: "Iron Plate, 360
  items/min" out, three "120 items/min" in. So the source end of a fanned-out line is the port's label, and the claim
  "a label at each end of a line" holds per port.

**Where it goes, and why labels do not collide.** The layout makes room for labels instead of searching for it after:

- Each card side that has ports gets an **end-label band** as wide as its widest label plus `END_LABEL_GAP` 4 each side.
  dagre gets the card's box widened by its two bands (the drawn card stays at its size inside it). The bands differ per
  side, so the drawn card sits off centre in dagre's box (shifted by half the difference of its bands), not centred in a
  box of twice the wider band. The router treats the widened box as the card for its columns, tracks and straightening:
  its column reach (`half` and `centres`, `orthogonalRoute.ts:120-130`) becomes a left and a right reach, while ends still
  attach at the drawn edge. The merged fallback and the make-room layout get the same boxes.
- No track, other card, label box or straightened run enters a band, so a label meets nothing but its own line. The
  labels of two ports on one edge are `PORT_PITCH` apart, which the inequality in Decision 1 sizes for two rows round
  the widest line plus a clearance, so they never meet each other. Caps sit inside the card and pills on its top and bottom edges,
  outside the port band, so labels never meet them.
- Two cards are never closer than their two bands and the tracks between them, which removes the owner's known weakness
  in a normal layout. The picture gets wider by about two bands per rank; build PR 3 records the width on the demo and
  the measured scenes.

**The fallback rule (owner pick 4).** After routing, a pure `endLabelFit(layout)` pass checks each port's label: its
first leg (from the port to the nearest track among its lines) is at least the label's width plus `2 × END_LABEL_GAP`,
and its box meets no card, port, cap, frame tab, label box or other line. A **line draws its two end labels only when the
labels at both its ports fit; otherwise it draws its middle bubble** exactly as ADR-0060 does (with focus, the ring of a
stalled source, the morph). The fit fails where the band is missing or squeezed: the grid fallback, the merged fallback's
stacked boxes, a frame too narrow for its ports, a make-room layout's moved neighbours. A port whose label does not fit
draws no label, so every line on that port draws its middle bubble; lines on other ports are not affected.

**The middle box stays reserved.** dagre still reserves each line's label box, now sized for one item (a line carries one
item, so `bubbleRowSize` of one bubble and the rate row). That keeps the fallback a one-pass layout with no line left
without room, keeps ADR-0060's make-room (the focused line's box grows to the detail card), keeps the morph's origin, and
keeps the transport glyph's rest place. On a line with end labels the box is drawn empty, so the middle stays clear. The
march layer's mask keeps its hole there as today.

**Level of detail.** Below `BUBBLE_DETAIL_ZOOM` (0.4) end labels draw no text and ports draw plain discs, as bubbles do;
the layout does not change with zoom.

**Pointer and focus.** A click on an end label of a port with one line focuses that line's item (ADR-0060 Decision 2,
unchanged state `{ edgeKey, item }`). A port with several lines opens the list of its lines in the overlay, the pattern of
the "+k" chip's `ItemList`, each entry focusable as a bubble is. The label's target is the label's box grown to
`PORT_PITCH` tall, at least 24 by 24 (WCAG 2.5.8), adjacent labels each meeting it on their own.

**What this changes in ADR-0060** (the pointer lines are added there):

- Decision 1 ("the bubble row replaces the label box"): with ports on, the bubble row is drawn only on fallback lines.
  The box is still reserved and still the row's size, now one bubble. The "+k" chip and its list are reached only with
  the flag off (a line carries one item with it on), and are removed with the flag (build PR 7).
- Decision 2 (hop-1 focus): unchanged as a rule; how dimmed things look changes (Decision 3 below). "No new token" is
  superseded by Decision 3's dim tokens.
- Decision 4 (the morph): unchanged; it grows from the reserved middle box, whether the line draws its bubble or its end
  labels.
- Decision 5 (keyboard): unchanged. `bubbleStops` keeps one stop per line and item whether the bubble or the end labels
  are drawn, with the same names.
- Decision 7 (budget): see Decision 5 below.

### 3. Dimming outside the focus

**One pure rule.** A new `focusSet.ts` (pure, next to `graphModel.ts`) returns, for a laid scene and the viewer's state,
the lit cards, the lit lines and the emphasised cards. `SiteGraph`'s `lit` and `edgeLit` call it. A line is lit only when
both its cards are lit (so the line from a dimmed outside group into the factory is grey, as the owner described), except
in item focus, where the focused line is lit by itself (ADR-0060).

**What the focus is, state by state.** The first state that applies wins, in this order:

| # | State | Lit | Dimmed | Emphasised |
|---|---|---|---|---|
| 1 | Item focus (ADR-0060) | The focused line and its two cards | Everything else | — |
| 2 | Show what a card feeds and needs | The card and everything upstream and downstream of it, over all items: `reachFromCard(cardKey, layout.flows)` in `graphModel.ts`, a walk both ways on `from`/`to` (ADR-0050's "everything this group feeds or depends on"), which does not walk across a return flow, so a loop does not light the whole factory | Everything else | — |
| 3 | Item filter | `reachFor` of the item, as today | Everything else | — |
| 4 | A card selected (its group panel open, in an opened factory or site) | The card, its hop-1 neighbours and the lines between them | Everything else | — |
| 5 | Nothing selected, an opened factory | The groups in the factory's home site | Its groups outside the home site (`remoteInfo`), and their lines | The groups that make the factory's products (`FactoryModel.products`, `hierarchy.ts:43`, what its overview card lists) |
| 6 | Nothing selected, the overview (any level, blown up or not) or a site scene | Everything | Nothing | — |

- **State 2** is a new button in the group panel, "Show what <card> feeds and needs", worded apart from the item card's
  existing "Show the whole path" (which sets the item filter, state 3), and announced apart ("what <card> feeds and
  needs" against "carries <item>"), since ADR-0060 Decision 2 warned against two gestures with one look. It is state,
  not a filter: Escape, the panel's Close or a background click ends it, in that order in the Escape chain (after item
  focus, before the panel).
- The item filter keeps priority over a card selection (3 before 4), so opening a group's panel while filtering keeps the
  filtered picture.
- State 5 is the owner's "raw inputs from outside the factory"; with no group outside the home site, nothing dims. The
  emphasis is open question 3; state 5's dimming is open question 1, state 4's is open question 2.
- Lasso, Select mode and picks change no dimming (picks are tinted, as today).

**What dims, and how.** Dimming moves from opacity to colour, so dimmed text stays readable:

- **Lines:** the dim line colour, whatever their carrier (pipe blue and mixed amber go grey too); width keeps its rate
  step; a mixed line's inner stroke and a transport's double line keep their shape in grey.
- **Cards:** fill unchanged; border in the dim line colour; title and lines in `--color-muted`; building and item icons
  grey (Tailwind's `grayscale`, a scale class, so a token by the frontend rules).
- **Ports and end labels:** the disc's ring in the dim line colour, the icon grey, the label's words in `--color-muted`.
- **Middle bubbles and caps of dimmed cards:** the same treatment.
- **Motion:** a dimmed line does not march, a dimmed cap does not move, and a transport glyph on a dimmed line stays at
  rest. `marchCandidates` and the caps' and glyphs' candidate lists take only lit things, so each cap's budget goes to
  what is lit.
- **Emphasis:** a heavier border (`stroke-fg-strong`, 2 wide) on the emphasised cards and on their output ports' rings.
  No new colour: amber stays the accent and power, never a status (ADR-0041).

**Contrast rules.**

- Dimmed **text** is never below WCAG 1.4.3 AA: it wears `--color-muted`, which build PR 1's contrast test checks at
  4.5:1 or more on the canvas, the surface, surface-2 (expected about 5.6:1) and a picked card's tint (the belt grey's
  7.4:1 on the canvas is in `index.css`'s own notes). No opacity is put on anything that holds text.
- **Dimmed must still look dimmed.** Muted text against lit `--color-fg` is a small step on its own; the grey lines, grey
  borders and grey icons carry most of the effect. Build PR 1's screenshots go to `ui-reviewer` and the owner with that
  question; if lit and dimmed are not clearly apart, the fallback is a darker dimmed card fill (a new token, tested so the
  muted text on it still clears 4.5:1).
- Dimmed **lines, port rings and card borders** take a new token, `--color-graph-dim-line`, chosen in build PR 1 between
  `--color-line` and `--color-muted`, and tested to be at least 3:1 on the canvas and the surface (WCAG 1.4.11: a dimmed
  line still says a flow exists) and clearly below the lit lines' contrast. The test sits beside `lineWidth.test.ts`'s
  contrast checks.
- `--opacity-graph-dim` goes once nothing uses it (build PR 1).
- The change of state is a colour transition of `--duration-fast`, zeroed under reduced motion like every motion token.

**Stalled marks.** A dimmed stalled card or line keeps its mark's **shape** (stop bar, ring, glyph). Whether it also keeps
its **tone** (amber, blue, grey) is open question 4; the recommendation is yes, so a stopped line outside the focus is
still noticed (backed up is information the outline also lists first).

**Legend.** Two rows join "Line styles" (ADR-0062 amendment build PR 5), each shown only when the canvas draws its kind,
like the others: **"Port: an item in (left) or out (right)"** with a still port sample, and **"Dimmed: outside the focus"**
with a grey line sample. When emphasis is drawn, a third: **"Heavier border: makes the factory's product"**. Nothing in the
legend moves.

### 4. Accessibility and the text path

- **Nothing new is focusable** on the canvas. Ports and end labels live inside the `role="img"` `<svg>`, so they are
  presentational; their words are in `<title>` for pointer users and already in the text path: each line's button
  (`bubbleName`: item, rate, ends) and the card's description (its inputs and outputs). A screen reader gains nothing new
  to tab through, and loses nothing.
- The **keyboard path** to every line stays the bubbles' one roving tab stop, whichever the line draws (Decision 2). The
  port-line list (a port with several lines) is reached from that line's button as the "+k" list is, and Escape closes it
  first.
- **Dimming is announced** in the existing `role="status"` line: "Showing what <card> feeds and needs: 12 of 40 cards", "Showing
  <card> and its neighbours", "Overview". State 5 (the default context) is said once in the canvas's accessible name
  ("3 groups outside the home site are dimmed"), not announced.
- **The outline stays the text form** and does not dim: every group, flow and rate is in it as before. "Show in graph"
  still selects the card (state 4).
- **Reduced motion:** nothing here animates except the dim colour transition, whose token is 0 under reduced motion.
  Ports and labels are still. The make-room glide is unchanged (ADR-0060).
- **Colour is never the only difference:** a port's side says in or out, a dimmed line is grey and still, an emphasised
  card has a heavier border, and every one of them has words.

### 5. Performance

| What | Count or budget |
|---|---|
| Ports per card | At most `2 × PORTS_MAX` = 12 |
| Ports per scene | At most two per line drawn, fewer where lines share a port: at most 420 on `planner-large` (210 lines), whose 160 groups mostly exchange one item each |
| End labels | One per port, two `<text>` rows each: at most 420 on `planner-large` |
| `<image>` elements | Ports plus fallback bubbles: at most about 420 on `planner-large`, under ADR-0060's ~600 budget, since middle bubbles are now drawn only on fallback lines |
| Where they draw | The canvas `<svg>`, still. `MarchLayer` gains nothing: the card's hole in its mask grows by `PORT_D / 2` on a side with ports, and end labels need no hole, since no other line enters a band and their own line runs between their two rows |
| Marching | The same caps (`MARCH_MAX` 60, `CAP_MARCH_MAX` 40, `GLYPH_MOVE_MAX` 40), now spent on lit things only |
| Layout | The 100 ms budget. Build PR 2 and 3 re-measure, with ports and bands on: the synthetic 160-group site (45-48 ms today), the four rows of `layoutScene.blowUp.test.ts` ("Expand all at the cap" is 53-76 ms today) and the caps scene, and record the blow-up rows in ADR-0061's note too. Past 100 ms, by ADR-0061's rule, `EXPAND_MAX_CARDS` comes down (or the band's name cut shortens), not a worker. While the flag exists there is one constant, the lower of the two measured caps, so the flag never lets a blow-up pass the budget |
| Frame time | The e2e regression bound (fitted p95 at most twice Motion Off's plus 17 ms) on `planner-large` with ports on; plus a new pan-and-zoom frame-time record, ports on against ports off, held to the same bound, since the canvas repaints on a zoom and now has more text |
| JS | About +2 KB gzip (`ports.ts`, `endLabels.ts`, `focusSet.ts`), in the planner's lazy chunk |

### 6. Contracts

None. `packages/shared` does not change. Ports, labels and the focus set come from `CanvasFlow`, the scene and
`remoteInfo`, all of which the client has.

## Build plan (each PR from `main`, no stacking)

Behind one flag, `planner.ports` in `plannerPrefs.ts` (validated, works without localStorage), off by default, as
ADR-0060 and ADR-0061 did. The demo build reads it as on unless it is `off`, so the owner reviews on the demo. Build PR 1
is not flagged: it changes how the two existing dim states look (an accessibility fix), with no new behaviour.

| # | PR | Files | Proof | Demo data |
|---|---|---|---|---|
| 1 | Dim tokens and `focusSet` | `index.css` (`--color-graph-dim-line`, drop `--opacity-graph-dim`), `focusSet.ts` with states 1 and 3 only (today's), every user of the opacity token: `SiteGraph.tsx` (lines, march strokes, moving glyphs, labels, cards, machine frames), `DestinationCaps.tsx`, and the tests that read it (`SiteGraph.test.tsx`, `SiteGraph.focus.test.tsx`, `SiteGraph.marchLayer.hunt.test.tsx`, `e2e/planner-graph.spec.ts`); contrast test | Unit tests of `focusSet`; contrast at 4.5:1 for dimmed text and 3:1 for the dim line on canvas and surface; the item-filter baselines change in this PR (not flagged); item focus, still behind `planner.itemFocus`, by its RTL test; lit and dimmed clearly apart on the screenshots (Decision 3); `ui-reviewer`, `test-hunter` | None new |
| 2 | Ports: model, layout and drawing | `ports.ts` (pure: sides from `returnFlows`, the fold to "+N", order by the router), `canvasScene.ts` (`bundleFlows` and `edgeKeyOf` by item when the flag is on), `layoutSite.ts` (`cardSize`, peer rule), `orthogonalRoute.ts` (sides as input, ends at port heights, same-port levels in `free`, track ties), `SiteGraph.tsx` (port discs, both arrowhead forms behind the flag, trims from the disc's edge, the stop bar at the port), `marching.ts` (`marchHoles`), `plannerPrefs.ts` (the flag), `frontend-planner-map.md` | Unit tests: one port per item per side, return ports, "+N" past 6, one line per item; ADR-0059's metrics test with ports on (no edge through a card, crossings within 10%); the layout benchmarks recorded here; flag off draws exactly today's canvas (baselines unchanged); `test-hunter`, `ui-reviewer` | Demo world: a group with 7 inputs (the fold), a fan-out, a loop, a train on a port |
| 3 | End labels and the fallback | `endLabels.ts` (pure: label words, bands, `endLabelFit`), `layoutSite.ts` (bands to dagre, the off-centre card in its box), `orthogonalRoute.ts` (left and right column reach, tracks and straightening outside the bands), `SiteGraph.tsx` (labels, the empty middle box, fallback bubbles, level of detail), the port-line list in the overlay | Unit tests of the fit rule (a long line gets two labels, a squeezed one its bubble, the grid none) and of the `PORT_PITCH` inequality; no label meets a card, cap, pill or other label on the dense scenes; picture width recorded; layout benchmarks again; `test-hunter`, `ui-reviewer` | A pair of cards in a narrow frame (the fallback), an unknown-item line |
| 4 | Motion, focus targets and frame times | `marching.ts`, `capLayout.ts` and `glyphMotion.ts` (lit candidates only), `ItemFocusLayer.tsx` (stops unchanged; the port-line list's Escape), e2e frame-time and pan-zoom records | The regression bound with ports on; keyboard reaches every line with labels drawn; axe | `planner-large` with the flag on |
| 5 | Focus states and the legend | `focusSet.ts` (states 2, 4, 5 and emphasis, per the owner's answers), `graphModel.ts` (`reachFromCard`), `GroupPanel.tsx` ("Show what ... feeds and needs"), the status line, `Legend` rows | Unit tests per state and their order; e2e states `planner-dim-context`, `planner-dim-select`, `planner-dim-path`; axe with dimmed text; `ui-reviewer` | Demo factory with a group outside its home site |
| 6 | Demo and review | demo world, e2e states (`planner-ports`, `planner-ports-overview`, `planner-ports-fallback`), baselines in CI's image (`npm run baselines`) | `ui-reviewer`; the owner reviews on the demo | The demo's own world, never the fixtures |
| 7 | Flag removed | `plannerPrefs.ts`, every flag-off branch, the "+k" chip and its list (ADR-0060 build PR 2's chip), this ADR's note | After the owner's demo review only; baselines | — |

Build PR 5 waits for the owner's answers to open questions 1 to 4. Build PR 2 does not wait for question 5: it draws both
arrowhead forms behind the flag, and the answer only picks which one it uses. PRs 1, 3 and 4 wait for none.

## Review (2026-11-01)

An independent `architecture-advisor` review of this ADR's first draft verified the cited code and found no blocking
issue and no accepted decision contradicted. Its gaps are folded in above: the `PORT_PITCH` inequality (44 became 48),
`PORT_INSET` clearing a disc's radius as well as the pill's touch target (22 became 32), the "+N" port's label and its
units, mixed links' port, sides passed to the router instead of derived from columns, same-port lines in the
straightening pass and track ties, per-side band widths (the card off centre in dagre's box), a port that does not fit
sending all its lines to their bubbles, line trims measured from the port's disc, the opacity token's full list of users,
a check that dimmed still looks dimmed, state 2's function and wording kept apart from the item filter, the frame sizing
for a group opened into its machines, the blow-up measurement recorded in ADR-0061 too, and which PR waits for which
answer. No disagreement is left open.

## Consequences

- Which item goes in and out of a card, and where, reads from the card's edges; a long line reads at either end, and its
  middle is empty.
- Lines carry one item each, so a pair of cards that exchange three items draws three lines (more lines on the overview,
  measured in build PR 2), and the "+k" chip goes with the flag.
- The picture is wider (two end-label bands per rank) and cards with many items are taller; in exchange two cards are
  never too close for labels in a normal layout, and the middle bubble covers every other case.
- Dimmed things are grey and still rather than transparent, so their words stay readable and the march budget goes to what
  is lit.
- The router has one more input (port heights) and one more rule (bands); dagre is unchanged.

## Not decided / later

- **Free dragging of cards with saved positions** (owner pick 5): on hold. It would be new persistent state and a layout
  that is no longer pure; not designed here.
- **Routing lines around cards** (owner pick 5): on hold. It includes taking a return flow round its cards into the left
  input port, which today enters on the right (Decision 1).
- **Open ports for an input no line feeds** (a recipe's ingredient with no supplier drawn as a hollow port): a natural
  next step that would show missing supply on the card; it needs the node's ingredients as ports, not only drawn lines.
  Later, if the owner wants it.
- **Lines of different carriers on one port** overlap on their first leg (a belt under a train's double line); offsetting
  them is left until a real save shows it matters.

## Open questions for the owner

1. **Default dimming in an opened factory** (state 5): with nothing selected, dim the factory's groups outside its home
   site and their lines? **Recommended: yes** (it is the owner's "raw inputs from outside the factory"; a factory with
   none dims nothing; the overview never dims by default).
2. **Selecting a card dims to its neighbours** (state 4) while its group panel is open? **Recommended: yes**, hop-1 as
   item focus does (ADR-0060 answer 1), with "Show what ... feeds and needs" in the panel for the whole reach.
3. **Emphasise the factory's product groups** with a heavier border (no new colour) when nothing is selected?
   **Recommended: yes**, in an opened factory only.
4. **Stalled marks keep their tone when dimmed?** **Recommended: yes**: the shape and the state's colour stay, only the
   line and card go grey, so a stopped line outside the focus is still seen.
5. **Drop the arrowhead on lines into a left input port** (Decision 1)? **Recommended: yes**, keeping it on return lines;
   the port's side, the legend's port row and the marching dashes carry the direction.

### Owner's answers, 2026-11-01
Questions 1-4, verbatim picks: "Yes, dim them" (1), "Yes" (2), "Yes, inside a factory" (3), "Keep their colour" (4).
Question 5 is still open; build PR 2 builds both forms behind the flag, and the owner picks on the demo (PR 6).

## Revisit when

- Ports add more than 10% crossings on the dense scenes, or the owner finds the order hard to follow on a real save: try
  a fixed order (by rate) or our own crossing passes over dagre's order (ADR-0059's Revisit).
- A layout with bands passes 100 ms: shorten the name cut, then lower `EXPAND_MAX_CARDS`.
- The picture gets too wide to read at the fitted zoom on a real save: a one-row label (name and rate on one line, longer
  bands, shorter cards) is the alternative.
- Fallback bubbles turn out common on real saves (the fit failing often): look at the band rule before adding a second
  placement pass.
- Free dragging or routing around cards comes off hold.

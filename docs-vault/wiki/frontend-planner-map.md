# Frontend: the Planner, Map and metrics pages

How three of the pages in `frontend/` are built. Moved out of `frontend/CLAUDE.md` on 2026-10-26 to keep that file
short; its hard rules (tokens only, the lazy chunks, the CSP gates, operator-only metrics) are still summarised there.

## Planner (ADR-0050, `src/planner/`)

- A tab after Factory (`PLANNER_IN_NAV` in `src/shell/tabs.ts`, on since the graph view landed). It shows the
  factories when the response has `factories` (ADR-0055; sites otherwise), as a canvas or as cards and a flows table,
  and one opened factory as a Graph or Tables view. The graph is the default from 640 px, the tables below
  (`useWideScreen`).
- The hierarchy is pure in `src/planner/graph/hierarchy.ts` (bubbles from `treeKey`, the fold cap, flows summed between
  cards, factory models); its words are in `plannerText.ts`.
- What the canvas draws is data first: `canvasScene.ts` turns a graph and the viewer's choices into cards (a factory, a
  bubble of one recipe from one source tree, a group, the "N more trees" fold), frames (an opened bubble's groups) and
  summed flows, with no React and no dagre.
- A bubble opens in place into its groups inside a frame (Collapse on the frame, Collapse all and Expand all in the
  toolbar); a factory above `COLLAPSE_AT` groups starts collapsed.
- A card's "+N" pill hides what only feeds it (the backend's `collapseUnder` tree), and the Storage detail toggle folds
  buffers and terminal storage into chips.
- A transport wears its mode's glyph (`transportGlyphs.tsx`, tokens only, moved by SVG `animateMotion`) on a double line
  (ADR-0062 amendment build PR 4: `lineStroke`'s `double`, a `TRANSPORT_W` stroke with a `stroke-surface` `TRANSPORT_GAP`
  over it, `data-double`/`data-double-gap`; one geometry at any rate; it never marches). The glyph never moves in a hidden
  tab, past `GLYPH_MOVE_MAX` (40) in the settled view, during a glide or a lasso, or under System with reduced motion
  (Motion On still moves it). Moving, it is drawn by `MarchLayer`, not the canvas (`glyphMotion.ts`: `glyphCandidates`,
  `movingGlyphs`), and rides `motionPathAround` (`edgeShapes.ts`): the route minus its own label box grown by the halo, a
  moveto jumping the gap, so it never crosses the item bubbles; the layer's mask (every pill and card a hole) is the
  backstop. At rest (only then drawn in the canvas) it stands in the pill's left `GLYPH_INSET` (the halo plus a gap), clear
  of the bubbles and the rate text.
- A group card of more than one machine with ids opens into its machines (Expand pill at its bottom right, and a hidden
  button in "Open and close parts of the graph"). Opened, the card is a dashed frame with its title and Collapse in a
  header and a grid of machine cards (`machineSlot`, `machineFrameSize` in `layoutSite.ts`; at most `MACHINES_MAX` (48),
  then a "+k more" card that opens the group panel). It stays one card to dagre, so the group's lines join the frame (the
  game reads belts per group; `MACHINES_FRAME_NOTE` says so in its words). A machine card's words are `machineCards.ts`:
  the Factory read's building by id (name, state and clock, first output), or for a machine that read lacks (a generator,
  a storage) its group's fuel or product and "State not read". Each machine is a hidden button after its group's; a click
  opens the group panel marking it (`aria-current`), Escape closes the panel back to it, then folds the group back to its
  card. Remembered per factory in `foldMemory`'s `machines`; Collapse all clears them, Expand all leaves them.
- Designations (ADR-0055 Decision 5) on the canvas: for owners and admins an opened factory's canvas has Select mode
  (toolbar button, or Shift+drag). A freehand lasso picks the group and bubble cards whose centre it encloses
  (`graph/lasso.ts`, pure), and in Select mode a click or a card's hidden button picks one card. The picks are the
  same set as the Groups table's ticks, under one `DesignateBar`, and Escape clears them. A picked card is tinted,
  with a check mark. The overview draws automatic factories like designated ones (no dashed outline); the "Reason
  factories for me" suggestion mode and its Keep pill were removed (the owner, 2026-10-27).
- Merge and split (ADR-0055 Decisions 11 and 12, #727), owners and admins on a backend with `revision`: on the overview,
  Shift- or Ctrl-click a factory card (or tick a card's Select in Tables) to pick it; `MergeBar` offers "Merge into one",
  disabled with its reason unless the picks are one connected piece by themselves (`connectivity.ts`: edges, transports,
  shared nodes, undirected) and within the caps (`selectionPlans.ts`). `MergeBar` stands idle ("No factories selected")
  before the first pick, so a pick never pushes the canvas down, and its count is one live region that stays mounted
  while the name form opens below it (as in `SplitBar`). In an opened designated factory the picks feed
  `SplitBar` instead of `DesignateBar`; a Groups row and the group panel have "Pop out" (a panel's failure shows in the
  panel, a row's on the page: `usePopOut`'s `write` and `popOut`); Remove is Dissolve. Every change
  is one replace built by `designationOps.ts` (pure, round-trip tested) and run by `designationChanges.ts`, whose undo
  (the read pre-image, never the matcher's ids) `UndoToast.tsx` offers for `UNDO_MS`, holding while focused or hovered.
  `designation_stale` re-reads and drops the selection. The demo keeps designations in memory (`demo/designations.ts`).
- Nested factories (ADR-0061 build PR 3), behind `planner.nesting` in `plannerPrefs.ts` (off by default, no control; set
  it to `on` in localStorage; build PR 6 removes it). `factoryTree.ts` (pure) builds the tree from the designations'
  `parentId` (the graph's `parentDesignationId` while the list has not answered). A parent with no machines of its own
  has no graph factory, so it is keyed `factory|designation|<id>` and named from the list. A parent's card is a roll-up
  (`FactoryModel` with `atLeast`): machine and state counts summed, products its parts' minus the flows between them,
  clamped at 0, a product used up inside dropped, "at least" where such a flow is estimated or unknown. Its own machines
  are one more part, "<name> (own machines)", keyed `<key>|own`. Bad data never throws: a missing parent is top level, a
  cycle is cut at its smallest id, a level past 3 hangs under its level-2 ancestor, and an empty designation is dropped.
  - The address is the path, root first: `?open=a&open=b` (`getAll`), so a #776 link with one key is a path of one. The
    longest valid prefix is kept (`resolvePath`); a bad tail is replaced in the address, with "That factory is no longer
    here." in a `role="status"` line (the entry is marked `plannerTrimmed`). Trimming waits for the designation list.
  - Opening a card pushes one level; Back ("All factories", or "Back to <parent>") steps back through history when the
    Planner pushed that entry, else replaces the address with one level up. A breadcrumb (`nav` "Factory path", buttons,
    `aria-current="page"` on the last) shows once anything nests. A level change focuses the new level's heading.
  - `overviewScene(graph, models, path, tree)` draws the parent's parts (top level for an empty path), each group owned
    by its shown card (`levelOwner`), so flows inside one card vanish and flows that leave the parent are not drawn;
    `Scene.path` and the name "Factories in <parent>". Merge picks only plain factories at the top level until PR 5.
  - Blow up (build PR 4, same flag): `overviewScene(..., expanded)` replaces each expanded card by a frame of its parts (a
    parent's factories, or a factory's groups as group cards), depth first, at most `EXPAND_MAX_DEPTH` (2) frames deep and
    `EXPAND_MAX_CARDS` (60, measured: see the ADR's note) cards; flows re-aggregate at the finest card. `Card.blowUp`
    (parts, noun, fits) draws an Expand pill (drawn disabled past the cap: "Too large to expand here; open it", and a click
    or its hidden button opens the factory); `Frame.expands` and `Frame.parent` mark a blow-up's frame, a nested dagre
    compound node (`roomForNestedTabs` keeps a nested top `NESTED_FRAME_RISE` below its parent's, so the tabs keep apart
    and the Collapse pills' `PILL_HIT` targets never meet). The toolbar's Expand all, disabled, says why. Keyboard:
    hidden "Expand <name> in place ..." buttons, focus into the frame, Escape on a part collapses it; toolbar Expand all
    (`expandAllKeys`) and Collapse all. Remembered per path in `foldMemory` (`expanded`, `overviewFoldsKey`). Opening a
    card inside a frame pushes its chain (`pathBelow`). Cards glide by the make-room tween; reduced motion jumps.
- A node with `stale: true` (#728 cause 11: built only from conveyor ends that name machines the latest factory read
  lacks) wears the clock glyph and prints only the muted `STALE_NODE_NOTE` (`graphModel.ts`), wrapped to the card's line
  limits; the tooltip, the side panel and the Tables view say the whole sentence.
- The viewer's choices are `plannerPrefs.ts` (localStorage in try/catch, validated; the page works without it).
- The graph (`src/planner/graph/`) is a lazy chunk (`SiteGraph.tsx` behind `GraphLoader.tsx`, the Map's pattern) and
  the only place `@dagrejs/dagre` is imported.
- `layoutScene` in `layoutSite.ts` is pure and deterministic (sizes from text, left to right). It is memoized by the
  response's `topologyHash` plus a signature of the cards, flows and sizes: a poll that only moves rates reuses the
  placement, and the words are never part of the memo. When dagre throws it falls back to parallel flows merged into
  one routed edge with stacked labels, then to a plain grid.
- Edges (ADR-0059): loops are broken first by `returnFlows` (depth-first from the sources; returns handed to dagre
  reversed, their routes turned back after), dagre places cards and label boxes (`tight-tree` ranker), then
  `orthogonalRoute.ts` redraws every edge in horizontal legs through columns and vertical legs in the empty gaps between
  them, one track each (at least `TRACK_GAP` apart), so no line crosses a card. `edgeShapes.ts` draws each bend as a
  rounded corner. If the router throws, dagre's own routes are drawn and `layoutStats().routerFailures` counts it.
- One line per pair of cards (ADR-0059 amendment, 2026-10-27): `layoutScene` draws the links between the same two cards,
  in one direction, on one carrier and of one kind as one edge (`bundleFlows` in `canvasScene.ts`). `SiteLayout.flows`
  stays one entry per link and `LaidEdge.parts` indexes them: the item filter lights an edge when any part matches, the
  tooltip (`flowTitle`) lists every link with its own rate, and the Tables view is untouched. `SiteGraph` draws all
  lines, then all labels.
- Width means rate (ADR-0062 amendment Decision 4): `lineStroke` (`lineWidth.ts`) gives a belt or pipe line 2, 3 or 4
  from `rateStep` on its (a bundle's summed) rate, 2 with no step; a mixed line keeps its width and gets a thin
  `stroke-surface` inner stroke (`data-mixed-inner`), never extra width. Transports draw a 6 double line (above) into their own arrowhead marker (`-double`). The line stops
  `LINE_UNDER_ARROW` short (`roundedOrthogonalPath`'s `trimEnd`) so it ends inside the arrowhead; see the amendment's
  "Values chosen in build PR 2".
- Marching dashes (ADR-0062 amendment build PR 3, `marching.ts`): a belt or pipe line with a measured or estimated rate
  that is not stalled moves source to destination at its `rateStep`, by CSS class only (`animate-flow-*`, timed by
  `--duration-flow-*`, `data-march` on each animated path). An estimated line's dashes march (a mixed one's inner dashes
  in step); a measured line stays solid and gets a thin pulse path (`data-march-pulse`) that is invisible except while
  animating, so the still frame is unchanged. Unknown and stalled lines and transports stay still. Only lines whose
  route's box meets the settled view (`useSettled`, `MARCH_SETTLE_MS` after the last pan or zoom) march, at most
  `MARCH_MAX`, fastest step first then edge order. Motion Off, reduced motion (even with Motion on), a hidden tab and a
  make-room glide march nothing; reduced motion also zeroes the tokens and `[data-march]` gets `animation: none` as a
  backstop. The Motion control shows when a transport or a marching line exists.
  The marching strokes are not in the canvas: `MarchLayer` (SiteGraph.tsx) is a second `<svg>` after the canvas in the
  viewport box, with the canvas's viewBox, fit, transparent 1px border and pan/zoom transform, `aria-hidden`,
  `pointer-events-none` and `will-change-transform` (its own compositing layer), rendered only while something marches.
  An animated path inside the canvas repainted the whole canvas every frame; in the layer it repaints only the layer. The
  canvas draws every line still, always; the layer draws over it an estimated line's moving dashes (over a `stroke-surface`
  cover, `data-march-cover`, that hides the still dashes) or a measured line's pulses, each in `[data-march-edge]`. Its
  luminance mask has a hole for every label pill, card (its edge badge and pills, a bubble's or fold's pile) and the open
  item card (`marchHoles`), so a stroke never shows over them; nothing marches while a lasso is drawn. Each stroke stops at the arrowhead's base (`MARCH_TRIM`), so the canvas's
  arrowhead is never painted over.
- Item bubbles (ADR-0060 build PR 2): an edge's label box draws the items it carries as icon bubbles, not words
  (`bubbleRow.ts`). Distinct items by summed rate (then name), at most `BUBBLE_MAX` (3) then a "+k" chip, with the rate
  text ("mixed", "excess" beside it) under the row; links of no known item share one "?" bubble. The box dagre reserves
  is `bubbleRowSize` (plus `GLYPH_INSET` for a transport), so the router keeps it clear as it did the words. A bubble
  draws its item's 32 px icon (64 px once that would stretch: `bubbleDetail`), the name's initials when there is none or
  it fails to load, never blank; below zoom `BUBBLE_DETAIL_ZOOM` (0.4) only plain discs. `LaidEdge.labelLines` keeps
  the words for text views and tests; the item names are in the edge's `<title>` and the Tables view.
- Stalled marks (ADR-0062 build PR 2): a card whose product reads 0 with all its machines backed up, underfed, paused or
  idle has `Card.stalled` (`stalledOf`), and the lines leaving it `CanvasFlow.stalled` (`withStalledFlows`; not a line
  measured above 0; a bundle only when every part is). In marks mode (`planner.stateStyle`, the default; the toolbar's
  "State marks" toggle, `aria-pressed`) the line ends in a stop bar in the state's tone instead of the arrowhead and its
  transport glyph does not move, its bubbles wear the tone's ring with one corner `StateMarkGlyph`, and the card draws the
  glyph on its note's row in place of the word (the row stays, so no size or layout changes). Words mode draws the canvas as
  before. Either way the words stay in the card's `<title>` and button name and the line's `flowTitle` ("The source is
  backed up").
- Destination caps (ADR-0062 Decision 1, build PR 3; values in the ADR's "Values chosen in build PR 3 (caps)"): `Card.caps`
  (`capModel.ts`, pure) is one cap per kind of end no line is drawn to: a factory card's `FactoryModel.destinations` (now with
  `rates`, summed per unit by `sumCapRates`), or in an opened factory with Storage detail off a group's or closed bubble's folded
  storage (`foldStorage`'s `chips` keep the flows). `cardSize` adds one fixed `CAP_ROW_H` row (and the row's width) only to a
  card with caps, so dagre and the router see a taller card. `DestinationCaps.tsx` draws the row (`CapRow`: a stub into a disc
  with the kind's icon or glyph, a count badge, "+k" past `CAPS_MAX`), the moving part (`CapMarchStroke`) and the keyboard's
  `CapButtons` (one roving tab stop, list "Where the cards' flows end", Enter shows the card's detail); `capLayout.ts` holds the
  geometry, `capCandidates`/`marchingCaps` and `capStops`. The step is `rateStep` on the cap's summed rate, so a cap and a line
  agree; unknown and stalled caps are still. The canvas draws every cap still; the moving part is drawn in `MarchLayer` (its own
  group and mask: only the item card is a hole), at most `CAP_MARCH_MAX` (40, `marching.ts`) in the settled view, beside the
  lines' `MARCH_MAX`. An estimated cap's stub leaves the canvas only while the layer moves it. The words are each cap's `<title>`
  and button (`capText`, `moreCapsText` in `plannerText.ts`); the chip words stay in the description, the panel and `FactoryFacts`.
- Item focus (ADR-0060 build PR 3), behind `planner.itemFocus` in `plannerPrefs.ts`. It is off by default and has no
  control: set the key to `on` in the browser's localStorage. Build PR 6 removes the flag after the owner's review.
  - Focus is `{ edgeKey, item }` (`edgeKeyOf`: ends, carrier, kind and unit, as `bundleFlows` groups them, so a poll that reorders edges keeps it). It clears
    when the line or the item leaves the graph.
  - Hop-1 dimming: only the focused line and its two cards stay lit, and the item filter's dimming waits until focus ends.
  - `ItemFocusLayer.tsx` holds the `sr-only` bubble buttons, one tab stop for all of them (a roving tabindex). Arrow
    keys, Home and End move between them, in the cards' tab order (`bubbleStops`). They are named by `bubbleName`.
  - The "+k" chip's button opens `ItemList`, the line's full item list, in the group panel's place. Each item in it can be
    focused.
  - Escape works in this order: the list, then focus (back to the bubble's button, or the chip's when the item has no
    bubble), then the existing chain.
  - A click on a drawn bubble focuses it, and a second click leaves. A click on the background leaves too, but a click on
    a card does not.
  - The status line stays mounted while the flag is on and says "Focused <item> from A to B" and "Overview".
  - Focus never zooms (owner answer 2).
- Detail card (ADR-0060 build PR 5), `ItemCard.tsx` and the pure `itemCardText.ts`.
  - On focus, the bubble morphs into a `FOCUS_CARD_W` × `FOCUS_CARD_H` card centred on the line's label, in the box that
    make-room reserved (or over the bubble when focus only dims).
  - The morph: one `<rect>` tweened from a circle to `CARD_RX` corners. The icon grows to the 128 px file, and the words
    fade in over the last 40%.
  - Closing (Escape, the drawn ×, its hidden button, a background click, or focusing another item) runs the morph
    backwards, then removes the card. React renders the end state, so with no motion only the state changes.
  - The words come from `CanvasFlow` only:
    - the name, or "Item unknown" with the raw class (never an invented name);
    - the rate as the label words it;
    - from and to, the transport and route, and how many other items share the line.
  - Each line is cut by the character-width estimate; the full words are in its `<title>` and in an `sr-only` group in
    the DOM layer, with "Close <item> card" and "Show the whole path of <item>" buttons.
  - "Show the whole path" sets the item filter and leaves focus (owner answer 1). An unknown item has none.
  - `bubbleRowOrigin` and `bubbleCentre` are the bubble row's geometry, which `EdgeLabel` and the morph share.
- Make room (ADR-0060 build PR 4), on focus.
  - The layout: `layoutScene(scene, hash, { edgeKey, width, height })` reserves the focused line's label box at
    `FOCUS_CARD_W` × `FOCUS_CARD_H`, so dagre and the router move the rest aside. The pill is still drawn at its own size.
    Both layouts sit in the memo.
  - The budget: past `FOCUS_LAYOUT_BUDGET_MS` (100), by `SiteLayout.placeMs`, focus only dims.
  - The glide: on entering or leaving, the view moves by the focused line's shift, so its bubble stays put on screen.
    The cards (`data-node`) slide from where they were. The old lines and frames are drawn as a ghost (`data-ghost`) that
    fades out while the new ones fade in.
  - How it runs: one `useTween` loop writes `transform` and `opacity` attributes, never `style`. It lasts
    `--duration-slow` with the `--ease-standard` curve (`EASE_STANDARD`, which a test keeps equal to the CSS).
  - Reduced motion or Motion: Off: no glide.
  - Benchmark: on a synthetic site of the measured size (160 groups, 204 edges), 45-48 ms for each layout. See ADR-0060
    Decision 3.
- The group panel and the "+k" list are one floating, non-modal card (`CanvasOverlay.tsx`, the owner 2026-10-27; it was a
  full-height drawer from lg and stacked below). As tall as its content, up to the canvas less `OVERLAY_MARGIN`, then it
  scrolls inside; at most `--spacing-graph-panel` wide (`OVERLAY_W`, a test keeps them equal). From lg it stands beside the
  clicked card (or the line's label): right, else left, else below, else above, clamped inside the canvas
  (`overlayPlacement.ts`, pure). Below lg it sits centred on the canvas's bottom, at most half its height. The heading
  and Close stay put (`data-overlay-header`) while the body (`data-overlay-body`) scrolls; scrolled, the header draws a
  rule, and a fade marks more below. It is placed from the
  view on every render, so it follows a pan or zoom. If it opens over the card, the view moves once to clear it. Placed
  CSP-safely: an overlay `<svg>` over the canvas with a `<foreignObject>` at x, y, width and height attributes. It closes
  with Close, Escape or a background click; the click leaves focus on the viewport, the other two hand it back to the card.
- The canvas is SVG styled by token classes and attributes only (no `style=`), `role="img"` with a counts label. The
  keyboard reaches each card through a list of visually hidden buttons beside it (an image's children are
  presentational).
- Colours and sizes stay tokens; the node and label metrics in `layoutSite.ts` are tied to the `text-sm`/`text-xs`
  classes, so change them together.
- `e2e/build-output.spec.ts` checks that dagre sits in that one chunk, off the entry chunk, under 100 kB gzip;
  `e2e/planner-graph.spec.ts` is the CSP gate.
- A layout over 100 ms on a real site is Decision 3's trigger to move `layoutScene` into a worker (`layoutStats()` and
  `layoutScene.test.ts` time it).

## Metrics (ADR-0056, `src/metrics/`, `/app/metrics`)

- The operator's page. Since the ADR-0056 amendment (2026-10-26) `METRICS_TAB` in `shell/tabs.ts` is a tab after Servers
  whenever `canManageServers`, in the real app and the demo. The command bar's operator-only "Metrics" entry and
  `MetricsLink` on the Servers page stay.
- Chart-led (golden signals / RED, Grafana's stat row then trends then detail): `MetricsCharts.tsx` draws the headline
  row (seven tiles from `charts.headline`, each with an aria-hidden SVG sparkline) and the trend figures; the numbers and
  words are pure in `metricsTrend.ts`. Counts compare per hour (`hours`) as a percent; percentiles compare as the bucket
  step ("≤ 200 ms, was ≤ 100 ms"); a zero or missing baseline is "No comparison"; a worse change says "worse" with an
  icon, never colour alone.
- Every trend chart is `TrendChart.tsx`, one lazy uPlot chunk (CSP gate `e2e/metrics-charts.spec.ts`). Timings draw on a
  fixed log scale from 1 ms; the over value (`METRICS_TREND_OVER_MS`) sits on a shaded "> 5 s" band, never as 10 s. A
  null hour is a gap. Requests stack with 5xx on the baseline in `--color-bad`; other series use `--color-series-1..5`
  (fixed order) and p50/p95/p99 the `--color-ramp-1..3` steps, all validated against `--color-surface` (see the comment
  in `index.css`). Each figure has a one-line text summary; the slot height is a token, so the chunk moves nothing.
- The old tables are folded `<details>` ("System details", "Alert quality details"...) under the matching charts: the
  accessible text path. A section's reason for having no data is never folded. Without `charts` (an older backend, or a
  reason) the headline row says "Charts not available yet" and the Details still render.
- `Shell` routes it only when `canManageServers`, so anyone else gets the unknown-page redirect. A 403 from the read
  redirects the same way, a 429 is a calm retry note, and a 401 stays central.
- No polling (Refresh, 60 s stale time). Percentiles are shown as the bucket upper bounds they are (`metricsText.ts`).
- The demo's data is `src/demo/metrics.ts` ("Sample data").

## Map (ADR-0023, `src/map/`)

- Leaflet with CRS.Simple, in a lazy chunk (`MapCanvas.tsx`) that only the Map page loads.
- `projection.ts` is the one world-to-map mapping (`[lat, lng] = [-yM, xM]`; bounds cited from
  `docs-vault/raw-sources/world-coordinates.md`).
- Under the grid, `terrain.ts` draws the traced terrain (ADR-0023 decision 4 amendment): `terrain/terrain.json`,
  made by `scripts/map-terrain.mjs` from the game's map texture, loaded as its own chunk and drawn in the tile pane
  so it stays under every layer. Colours are `--color-terrain-*` tokens; `TERRAIN_ENABLED` is the takedown switch;
  `terrain/NOTICE.md` the licence boundary and the rebuild steps.
- Base maps are configs (a neutral grid). The base stays data-derived, but #571 reversed #330's "no game art" for
  resource nodes: `resourceIcons.ts` maps FRM's `Name` to the game's icon in `public/game-assets/` (NOTICE.md: not
  AGPL), and an unknown type keeps the circle.
- World layers (ADR-0038 M5: `railsLayer`, `resourceNodesLayer`) are `MapLayer<T>` over their own stored list:
  `MapPanel` reads them through `queries.mapRails`/`mapResourceNodes`, only while the toggle is on, and hands the
  canvas a bound `DrawnLayer`.
- The players' map markers and stamps (ADR-0038 §1, #330, `markersLayer`, `queries.mapMarkers`) are a world layer
  drawn above the buildings and under the trains: a marker a pin (tip on its place), a stamp a diamond a step smaller
  than a station's, fixed pixel sizes rebuilt on zoom. The fill is the marker's own `color` (game data, so a Leaflet
  path option, not a token; `ColorSlot` read as RRGGBBAA, verified by the owner in game on 2026-10-27); the rim is
  `--color-marker-edge`, so a dark one shows on the terrain. An empty name reads "Unnamed marker"/"Unnamed stamp";
  rows are keyed `${id}:${x}:${y}` (FRM ids can repeat), with a count added only on a full repeat. The game's icon
  (`icon`, FRM's IconID) isn't drawn: its mapping to an image is undocumented (follow-up).
- The power lines (ADR-0038 §1, #330, `powerLinesLayer`, `queries.mapPowerLines`) are a world layer off by default (a
  factory's wiring is dense where the buildings and markers sit, and the read is asked for only once on). Drawn over the
  rails and nodes and under the buildings as ONE non-interactive Leaflet multi-polyline (a sub-path per line, so 20,000
  lines are still one canvas path), a 1.5 px `--color-map-power-line` copper hairline. Text: "N power lines on the map,
  M m of wire in all." plus a "Power lines in view" table keyed `${id}:${index}` (FRM ids can repeat).
- The belts, lifts and pipes (#330, `conveyorsLayer`, `queries.mapConveyors`, the ADR-0048 amendment's `conveyors` world
  layer, toggle "Belts and pipes") are off by default (thousands of edges on a big save; read only once on). The layer is a
  connection graph: each edge has only end 0's position (`at`) and the ids at its ends, no spline. `conveyors.ts`
  (`placeConveyors`, pure) finds end 1 as the `at` of the conveyor joined to it (only when that one's `from` names this
  one), else the factory building under that id (same ids as getFactory; MapPanel keys the places by their JSON, so a poll
  that moves nothing doesn't redraw), else the nearest conveyor leaving the same splitter, merger or junction. Unplaced
  ends and every lift (it runs straight up or down) are dots. Drawn over the power lines and under the buildings as three
  non-interactive multi-polylines (pipes 2.5 px `--color-map-pipe`, belts 2 px `--color-map-belt`, lifts 6 px dots), the
  tokens pointing at the planner's own pipe (`--color-info`) and belt (`--color-muted`) colours. Text: "N belts, M pipes,
  K lifts on the map, L m of belt and P m of pipe measured, drawn straight between their ends." (only placed ends have a
  length; a kind with none placed says "pipe length unknown", "shown" when the layer was cut) plus how many are dots, and
  "Belts, lifts and pipes in view" (Kind, Tier, Length, From, To; ends in words, never ids), 500 rows max, keyed id +
  index.
- The drone ports (ADR-0055 Decision 1, #330, `dronePortsLayer`, `queries.mapDroneRoutes`, the `droneRoutes` world
  layer) are on by default (a save has a handful of ports, capped at 2,000) and in the Map page's reveal. Drawn over the
  buildings and under the markers: each port a fixed-size 10 px square in `--color-map-drone` (azure) with a canvas rim,
  tooltip from text nodes (name, "Paired with", "Carries:" input cargo), and ONE dashed non-interactive multi-polyline
  for the routes. Pairing (`dronePorts.ts`, `resolvePairings`): by `pairedId` when it's a string, else by name only when
  the name matches exactly one other port; an explicit null `pairedId` on a paired port is the sender's "couldn't
  resolve" and isn't looked up by name; self-pairings never match. Unmatched pairings draw no route and are counted:
  "N drone ports, M routes on the map. K pairings couldn't be matched to one port." Cargo names come from the live
  factory's items (`factory/itemLabels.ts`), else the class name made readable; MapPanel keys that by the names, so a
  factory poll doesn't redraw the ports. "Drone ports in view" table (Port, Paired with, Sends, Position), 500 rows max,
  keyed id + place (`dronePortKeys`).
- A layer is a `MapLayer` (`layers.ts`): it gets Leaflet through its `MapContext` (never imports it at runtime),
  draws on the shared canvas renderer (the node icons are DOM `L.marker`s, since a canvas draws no images here),
  returns its cleanup, and supplies a legend and a text `describe`.
- Tooltip content is built from text nodes, never an HTML string (names come from the game server).
- Every layer's data is also shown as text (the buildings-in-view table). Each "in view" table sits in a
  `ui/ScrollRegion` (focusable, labelled, `max-h-80`): while rows are cut below it fades its bottom edge (an
  `aria-hidden` overlay into `--color-surface`, `--spacing-scroll-fade` tall; not a mask, which would clip the focus
  ring) and shows a muted "Scroll for more" line, measured by
  `lib/useScrollCue` (ResizeObserver plus scroll); nothing when the rows fit.
- The caption under the map lists the world layers from `LAYERS` (`caption.ts`: each layer's lower-case label, or its
  `caption` noun, e.g. "players' markers"), so a new layer joins it with no hand edit; the buildings aren't listed.
- The live trains layer (ADR-0038 M6, `trainsLayer`) polls `queries.mapLive` every 10 s. `MapCanvas` redraws only from
  the first layer whose bound `draw` changed upward (`MapPanel` binds each layer once per change of its own data).
- A layer that animates times it by a motion token (`--duration-glide`), which reduced motion zeroes.
- `e2e/map.spec.ts` is the CSP gate (pan, zoom, hover, toggle); Leaflet overrides in `index.css` are unlayered.

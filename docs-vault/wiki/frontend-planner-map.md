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
- A transport wears its mode's glyph (`transportGlyphs.tsx`, tokens only, moved by SVG `animateMotion`). It never moves
  in a hidden tab or past 40 edges, and never at all under System with reduced motion.
- Designations (ADR-0055 Decision 5) on the canvas: for owners and admins an opened factory's canvas has Select mode
  (toolbar button, or Shift+drag). A freehand lasso picks the group and bubble cards whose centre it encloses
  (`graph/lasso.ts`, pure), and in Select mode a click or a card's hidden button picks one card. The picks are the
  same set as the Groups table's ticks, under one `DesignateBar`, and Escape clears them. A picked card is tinted,
  with a check mark. With "Reason factories for me" on, the overview canvas draws automatic factories dashed, with a
  "Suggestion" tag and a Keep pill (a hidden "Keep …" button for the keyboard) that opens `KeepForm`.
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
  them, one track each, so no line crosses a card. `edgeShapes.ts` draws each bend as a rounded corner. If the router
  throws, dagre's own routes are drawn and `layoutStats().routerFailures` counts it.
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

- The operator's page, never a tab in the real app, even for the operator. `METRICS_TAB` in `shell/tabs.ts` shows only
  when `IS_DEMO`, so demo visitors find it.
- The doors are the command bar's operator-only "Metrics" entry and `MetricsLink` on the Servers page.
- `Shell` routes it only when `canManageServers`, so anyone else gets the unknown-page redirect. A 403 from the read
  redirects the same way, a 429 is a calm retry note, and a 401 stays central.
- No polling (Refresh, 60 s stale time). Percentiles are shown as the bucket upper bounds they are (`metricsText.ts`).
- The demo's data is `src/demo/metrics.ts` ("Sample data").

## Map (ADR-0023, `src/map/`)

- Leaflet with CRS.Simple, in a lazy chunk (`MapCanvas.tsx`) that only the Map page loads.
- `projection.ts` is the one world-to-map mapping (`[lat, lng] = [-yM, xM]`; bounds cited from
  `docs-vault/raw-sources/world-coordinates.md`).
- Base maps are configs (a neutral grid). The base stays data-derived, but #571 reversed #330's "no game art" for
  resource nodes: `resourceIcons.ts` maps FRM's `Name` to the game's icon in `public/game-assets/` (NOTICE.md: not
  AGPL), and an unknown type keeps the circle.
- World layers (ADR-0038 M5: `railsLayer`, `resourceNodesLayer`) are `MapLayer<T>` over their own stored list:
  `MapPanel` reads them through `queries.mapRails`/`mapResourceNodes`, only while the toggle is on, and hands the
  canvas a bound `DrawnLayer`.
- A layer is a `MapLayer` (`layers.ts`): it gets Leaflet through its `MapContext` (never imports it at runtime),
  draws on the shared canvas renderer (the node icons are DOM `L.marker`s, since a canvas draws no images here),
  returns its cleanup, and supplies a legend and a text `describe`.
- Tooltip content is built from text nodes, never an HTML string (names come from the game server).
- Every layer's data is also shown as text (the buildings-in-view table).
- The live trains layer (ADR-0038 M6, `trainsLayer`) polls `queries.mapLive` every 10 s. `MapCanvas` redraws only from
  the first layer whose bound `draw` changed upward (`MapPanel` binds each layer once per change of its own data).
- A layer that animates times it by a motion token (`--duration-glide`), which reduced motion zeroes.
- `e2e/map.spec.ts` is the CSP gate (pan, zoom, hover, toggle); Leaflet overrides in `index.css` are unlayered.

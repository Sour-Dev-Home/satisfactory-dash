- 2026-10-28 — ADR-0062 amendment build PR 4: a transport (train, truck, drone, Depot) draws a double line: its stroke
  `TRANSPORT_W` 5.5 wide in the line's colour with a `TRANSPORT_GAP` 3 stroke in `stroke-surface` over it, two rails of 1.25,
  dashed alike when its rate is estimated or unknown (`lineStroke`'s new `double`, `data-double` and `data-double-gap`). One
  geometry for every transport, mixed or not, at any rate; the line stops 4.8 short of its end so the rails stay inside the
  arrowhead. Transports still never march. Their moving glyph left the canvas: `glyphMotion.ts` (`glyphCandidates`,
  `movingGlyphs`, at most `GLYPH_MOVE_MAX` 40, from the settled view) feeds `MarchLayer`, which draws each glyph riding
  `motionPathAround`'s path (still leaping its own label box) under the layer's mask; the canvas leaves out a moving glyph's
  resting copy. The glyphs also stop during a make-room glide and a lasso; Motion On still moves them under reduced motion.
  New scenario `planner-transports-large` (the caps' 48-factory overview plus 48 transports) and an e2e frame-time test in
  `planner-graph.spec.ts` under the lines' regression bound. Values in the ADR's "Values chosen in build PR 4".

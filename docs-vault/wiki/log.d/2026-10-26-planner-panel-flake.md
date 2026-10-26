- 2026-10-26 — Steadied the `planner-group-panel` screenshot, which flaked between two canvas framings (#701 hit
  both). The states spec focused a group's hidden button as soon as the SVG was visible, sometimes before the
  canvas's ResizeObserver had measured it, so the card was revealed against the 1000×600 fallback stage.
  `openIronGraph` now also waits for the viewBox to leave `FALLBACK_STAGE` (`canvasMeasured`).

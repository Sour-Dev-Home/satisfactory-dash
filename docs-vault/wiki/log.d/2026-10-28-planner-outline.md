- 2026-11-01 — ADR-0062 build PR 4: the outline replaces the Planner's two tables (the owner: "Tables seems unhelpful";
  owner answer 3). `PlannerOutline.tsx` over the pure `outlineModel.ts` is a nested list, not an ARIA tree: a summary
  sentence (machines, stalled, in loops); "Needs attention" (stalled outputs by output lost, then bottlenecks, then unknown
  ends, each with "Show in graph"); the tree (the level's factories, a parent's parts under it with the `planner.nesting`
  flag, then each factory's groups; over `OUTLINE_OPEN_MAX` 20 groups a factory starts closed) where each group is a
  sentence ("8× Constructor make Iron Plate: 72 / 160 items/min.", a 0 rate adding its `StateMark` and always its word)
  whose neighbours are buttons that move the keyboard to their rows; and "All connections", one sortable 5-column table
  (From, To, Item, Rate, Carrier, `aria-sort`) behind a disclosure, Capacity and Flow in each row's Details. The view
  toggle is Graph / Outline (state only, nothing to migrate); row actions are buttons (Select is now an `aria-pressed`
  toggle, was a checkbox; Pop out, Open factory and the designation controls as before). One selection with the graph:
  `SiteGraph`'s new `current` prop reports the card that takes the keyboard or opens its panel, and "Show in graph" gives
  the card the keyboard as the graph opens; the outline marks the row `aria-current` and focuses it. `PlannerTables.tsx`
  and `FactoryFlows` are no longer rendered (build PR 5 deletes them after the owner's review); the tests that read their
  cells read the outline. New e2e: the outline by keyboard with axe, the outline's render time on `planner-large`, and the
  `planner-outline-attention` state. Values and the render measurement in the ADR's "Values chosen in build PR 4 (outline)".

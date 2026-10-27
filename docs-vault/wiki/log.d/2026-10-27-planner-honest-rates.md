## [2026-10-27] fix | Planner: honest 0 rates and why items or rates are unknown (#728 steps 2 and 5)

Step 2: FRM's CurrentProd "decreases if an ingredient is unavailable" (`raw-sources/frm-getFactory.md`, E3), so a product that reads 0 now says "0 of <max>" with the group's state instead
of a bare "0/min": "Iron Ingot: 0 of 30 items/min · backed up" in the tooltip, side panel and Tables view, and
"Iron Ingot · 0 of 30/min" on the card with the state ("Backed up", else "Not producing") as a muted line under it. The
state is the one state all the group's machines are in (`stateCounts`), else "not producing"; a max of 0 reads "0". A
single machine's line in the side panel gets "0 of <max>" but no state, which is printed beside it. No contract change:
`PlannerRate.maxPerMinute` and `PlannerNode.stateCounts` already carry both.

Step 5: one plain line, "The game doesn't report what's on a belt or how fast it moves; items and rates are inferred
where possible.", under the canvas legend, under the Connections table when a row has an unknown item or rate, and
appended to the tooltip of a flow (or bundle) with an unknown item or rate.

- 2026-10-27 — ADR-0062 build PR 1 and its amendment's build PR 1, as one PR (no visible change): the flow tokens
  `--duration-flow-slow|mid|fast` (2.4s, 1.2s, 0.6s, zeroed under reduced motion) in `index.css`; `rateStep` in
  `planner/graph/rateStep.ts` (items/min steps at 120 and 480, a full Mk.2 and Mk.4 belt; m³/min at 300 and 600, a full Mk.1
  and Mk.2 pipe; null for a missing, zero, negative or non-finite rate and an unknown unit); `stalledOf` in `plannerText.ts`,
  sharing `stalledStateText`'s rule; `StateMark` (an SVG `<g>` for the canvas and an inline icon), one shape per state, toned
  from `machineState.ts`; `CanvasFlow.stalled?`, typed but not set yet. The ADR records the values, and flags that the mark
  colours follow `machineState.ts` rather than Decision 2's tokens line for the owner to confirm.

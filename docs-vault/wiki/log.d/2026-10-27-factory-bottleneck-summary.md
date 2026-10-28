- 2026-10-27 — ADR-0062 F.1: the Factory page opens with a compact bottlenecks summary (`factory/BottleneckSummary.tsx`) above
  "Since yesterday" and the table: the count ("3 bottlenecks", "10+ bottlenecks" when the backend cut the list, "No bottlenecks"),
  the first three causes in the backend's rank order as one-line rows (state word first; only the machine's name is cut), and a "Full list"
  link to the full section, which keeps its place at the bottom and gains `id="bottlenecks"`. The summary reads the same query as
  the list (`factory/bottlenecksRead.ts`, one cache entry, no new fetch). Its box is a touch-tall head row plus exactly three
  padded lines in every state (data, none, skeleton, and an unseen copy under the panel error), so the late bottlenecks read
  moves nothing below it (ADR-0032). `#bottlenecks` and the Planner's `#bottlenecks-heading` both jump to the list
  (`useHashTarget`; the link always pushes, so a second click jumps again). `bottleneckCountText` moved to `factory/bottlenecks.ts`
  (re-exported by `plannerText.ts`). New e2e state and scenario: `bottlenecks-error`.

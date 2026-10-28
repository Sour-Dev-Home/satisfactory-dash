- 2026-10-28 — ADR-0062 F.5: the Factory page's machine table renders its first `FACTORY_ROW_CAP` (50) machines, then
  "Showing 50 of N machines." (a status line) and "Show all N machines" under it, so the page height is bounded. The cap applies
  after the state filter and search, so a search or a `?q=` link still reaches any machine. "Show all" reveals the rest in place
  and moves focus to the first newly shown machine's name; "Show only the first 50 machines" caps it again and keeps focus on the control.
  A new filter or search caps the list again; the 30 s poll keeps it open. The logic is a reusable `useRowCap(rows, cap, resetKey)`
  (`factory/useRowCap.ts`) plus `ShowAllRows.tsx`, so F.2 can cap each group. Interim scope noted in the ADR's section F (one
  group until F.2). New scenario `factory-many-machines` (60 machines from the mixed fixture) and its e2e state.

- 2026-10-28 — ADR-0062 F.4: the Factory page's machine table gains an in-page nav (`factory/FactorySectionsNav.tsx`,
  "Factory sections": Machines, History, Bottlenecks) on the fragments the sections already honour, plus `#machines` on the
  table's section (`MACHINES_ANCHOR` in `lib/deepLinks.ts`, its own `useHashTarget`). The links keep the search (`?q=`, `?item=`)
  and always push, so a second click jumps again. The nav, the search and the state filters form one sticky bar
  (`FilterBar` in `FactoryPanel.tsx`, new `--z-sticky` token) bounded by a flex column holding the bar and the table (not the `.panel` grid, whose one-row grid area would pin it); on a phone only the nav and the
  search stick (the outer box is `contents` there) and the state filters scroll away, so the bar stays two rows. The three
  targets get `scroll-mt-4`. The factory skeleton mirrors the bar's rows, padding and rule.

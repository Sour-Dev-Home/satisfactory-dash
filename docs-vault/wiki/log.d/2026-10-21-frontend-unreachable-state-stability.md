- 2026-10-21 — Frontend: the app holds still while the game server is unreachable (the owner's report: panels
  "re-popped" and "Game server unreachable" notices stacked). TanStack Query v5 puts a read that never answered back
  to `pending`, with its error cleared, on every refetch, so each poll re-showed skeletons, collapsed the server
  banner row and re-mounted the Overview and the live power chart (which refetched its history each status poll).
  New `src/api/settled.ts`: `isFirstLoad` (pending and never settled) drives every affected `Loadable`, the Overview's
  rows and the power chart's wait, and `useSettledQuery` keeps a query's last error on screen through its refetches
  (remembered by the query cache, so a view that mounts mid-poll shows it too). The unreachable notice is now said
  once, by the shell's StatusBanners: Power, Power history, Factory, Map and Server settings show a quiet empty panel
  (`components/PanelError.tsx`) when status says the same; any other error kind, or an unreachable source the status
  read doesn't share, stays the panel's own. Tests: `App.unreachable.test.tsx` (fake intervals, checks mid-poll and
  after), `api/settled.test.tsx`, a StatusBanners mid-refetch case, and `e2e/unreachable.spec.ts` (page clock, ~30 s of
  polls on Overview, Power, Factory); `layout.spec.ts` now expects exactly one notice. The backend's
  `server_unreachable` alert was checked and doesn't re-fire while the game stays down (it renotifies at most hourly,
  by design); no backend change.

- 2026-11-01 — ADR-0062 F.2: the Factory page's machine table is grouped by the Planner's factories and groups, as collapsible
  sections with counts ("Iron Plate factory · 11 machines · 1 backed up", then "4× Constructor, Iron Plate"), with ADR-0061's
  parents nesting when `planner.nesting` is on, and "Other machines" for what no group names. The grouping is pure
  (`factory/machineGroups.ts` over `buildFactoryTree` and `factoryOfNode`) and reads the Planner's own cache entries: the owner
  chose to add the production graph (and, with nesting, the designations) to the Factory page's reveal queries, at one more
  computed read per poll, with a contract field on the factory read as the follow-up if backend load shows it. The disclosure
  tree's parts (`TreeHeading`, `Chevron`, `DisclosureHeading`, `useDisclosures`) moved from `PlannerOutline.tsx` to `ui/`, shared
  by both pages. The 50-row cap now applies per group; the filter and search apply across groups, and empty groups hide. A late
  graph paints the table flat and then regroups once (a known limit, in the ADR); a failed one keeps it flat with a note. New
  scenarios `factory-grouped`, `factory-grouped-nested` and `factory-groups-error` with e2e states; `factory-many-machines` is now
  one group of 55.

/** One tab of the signed-in app's main nav. */
export interface Tab {
  to: string;
  label: string;
  end?: boolean;
}

/**
 * ADR-0050: the Planner tab (nav, nav prefetch, command bar). It was routed but unlisted from task 5 until task 6 landed
 * the graph view; the owner's call was to show the tab then. A parameter below keeps the hidden form testable.
 */
export const PLANNER_IN_NAV = true;

const BEFORE_PLANNER: Tab[] = [
  { to: "/app", label: "Overview", end: true },
  { to: "/app/power", label: "Power" },
  { to: "/app/factory", label: "Factory" },
];
export const PLANNER_TAB: Tab = { to: "/app/planner", label: "Planner" };
const AFTER_PLANNER: Tab[] = [
  { to: "/app/map", label: "Map" },
  { to: "/app/settings", label: "Settings" },
];

/** ADR-0030: the operator only (hiding it is UX; the backend enforces). */
export const SERVERS_TAB: Tab = { to: "/app/servers", label: "Servers" };

/** The tabs a user sees, in order. `plannerInNav` is a parameter only so tests can show the post-PR-6 nav. */
export function visibleTabs(canManageServers: boolean, plannerInNav: boolean = PLANNER_IN_NAV): Tab[] {
  return [
    ...BEFORE_PLANNER,
    ...(plannerInNav ? [PLANNER_TAB] : []),
    ...AFTER_PLANNER,
    ...(canManageServers ? [SERVERS_TAB] : []),
  ];
}

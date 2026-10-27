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

/**
 * ADR-0056 (amended 2026-10-26, the owner's pick over an Overview card or an Account-menu entry): the operator's
 * metrics page is a tab after Servers, for the operator only, in the real app and the demo alike. The command-bar entry
 * and the Servers-page link stay. Hiding it is UX; the backend answers 403 to anyone else, and the shell routes it only
 * for the operator (Shell, paletteCommands).
 */
export const METRICS_TAB: Tab = { to: "/app/metrics", label: "Metrics" };

/** The tabs a user sees, in order. `plannerInNav` is a parameter only so tests can show the other nav. */
export function visibleTabs(canManageServers: boolean, plannerInNav: boolean = PLANNER_IN_NAV): Tab[] {
  return [
    ...BEFORE_PLANNER,
    ...(plannerInNav ? [PLANNER_TAB] : []),
    ...AFTER_PLANNER,
    ...(canManageServers ? [SERVERS_TAB, METRICS_TAB] : []),
  ];
}

import { IS_DEMO } from "../demo/mode";

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
 * ADR-0056: the operator's metrics page. In the real app it is never a tab, even for the operator (the owner's "not
 * easily reachable"): the command bar and the Servers page link to it. Only the demo build shows it, so visitors find it
 * (Q1). The route and the command are separate (Shell, paletteCommands).
 */
export const METRICS_TAB: Tab = { to: "/app/metrics", label: "Metrics" };

/**
 * The tabs a user sees, in order. `plannerInNav` and `metricsInNav` are parameters only so tests can show the other
 * navs; `metricsInNav` is the demo build, and the tab is still the operator's.
 */
export function visibleTabs(
  canManageServers: boolean,
  plannerInNav: boolean = PLANNER_IN_NAV,
  metricsInNav: boolean = IS_DEMO,
): Tab[] {
  return [
    ...BEFORE_PLANNER,
    ...(plannerInNav ? [PLANNER_TAB] : []),
    ...AFTER_PLANNER,
    ...(canManageServers ? [SERVERS_TAB] : []),
    ...(canManageServers && metricsInNav ? [METRICS_TAB] : []),
  ];
}

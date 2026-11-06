/**
 * The tour's steps (ADR-0065 "The steps"). Each names its page (`path`, `search`), its target (an element with that
 * `data-tour`, demo/tour/target.ts) and its words, which must stand alone: a step whose target never appears is shown
 * centred with no highlight. `try` steps (build PR 3) say how they are done by what appears or changes, never by reading
 * a page's state.
 */
export type TourDone = { appears: string } | { changes: string };

export interface TourStep {
  id: string;
  path: string;
  search?: string;
  /** None for a step about the whole page (the welcome): it shows centred with no highlight at once. */
  target?: string;
  title: string;
  body: string;
  kind: "next" | "try";
  done?: TourDone;
  /** A try-it step offers "Do it for me", a bubbling click on the target. */
  doForMe?: boolean;
  /**
   * A target only a click shows, which the address cannot open (the planner's group panel): when the step's own target is
   * not there, the tour clicks the element with this `data-tour` once it is ready, as "Do it for me" would.
   */
  openedBy?: string;
}

/**
 * The planner opened on the demo's "Plastic line" factory (`?open=` is `planner/PlannerView.tsx`'s OPEN_PARAM, the key is
 * `designatedKeyOf(DEMO_DESIGNATION_ID)`; steps.test.ts checks both). Its one group of machines, the oil refinery, opens
 * a panel; the iron works' Reinforced Iron Plate assemblers are a bubble of two that opens in place, not a panel.
 */
export const TOUR_PLANNER_SEARCH = "?open=factory%7Cdesignation%7C6f1c2a4e-3b5d-4c7a-9e1f-0a2b3c4d5e6f";

export const TOUR_STEPS: readonly TourStep[] = [
  {
    id: "welcome",
    path: "/app",
    title: "Welcome to the demo.",
    body: "This is a made-up factory from Satisfactory, a game about building factories. This tool watches a factory from outside the game. Nothing here is live.",
    kind: "next",
  },
  {
    id: "health",
    path: "/app",
    target: "overview-health",
    title: "Is everything OK?",
    body: "One glance says whether power, machines and the server are healthy, without opening the game.",
    kind: "next",
  },
  {
    id: "alerts",
    path: "/app",
    target: "overview-alerts",
    title: "Problems come first.",
    body: "Anything that needs attention, such as a machine that has stopped working or power running short, shows up here.",
    kind: "next",
  },
  {
    id: "power-chart",
    path: "/app/power",
    target: "power-chart",
    title: "Power over time.",
    body: "Factories run on electricity, and running short stops everything. This chart shows the power made against the power used over the last few minutes, so a shortage is seen coming.",
    kind: "next",
  },
  {
    id: "power-circuits",
    path: "/app/power",
    target: "power-circuits",
    title: "Circuits.",
    body: "A circuit is one connected set of power plants and machines. Each card shows how much of its capacity is in use, so a strained one stands out.",
    kind: "next",
  },
  {
    id: "factory-machines",
    path: "/app/factory",
    target: "factory-machines",
    title: "Every machine at a glance.",
    body: "Every machine, grouped by factory. A machine stops when its inputs run out or its output is backed up with nowhere to go. Each group says how many are backed up, and the buttons above list the machines in one state.",
    kind: "next",
  },
  {
    id: "factory-bottlenecks",
    path: "/app/factory",
    target: "factory-bottlenecks",
    title: "What holds production back.",
    body: "The tool works out which machines slow down the rest, worst first, one line each: underfed (not getting enough input) or backed up.",
    kind: "next",
  },
  {
    id: "planner-canvas",
    path: "/app/planner",
    search: TOUR_PLANNER_SEARCH,
    target: "planner-canvas",
    title: "A map of the production.",
    body: "This is the Plastic line, one of the demo's factories. Each box is a group of machines; the lines show what feeds what, with the item's name at each end.",
    kind: "next",
  },
  // build PR 3: try-it (`done: { appears: "planner-group-panel" }`, Do it for me clicks the card).
  {
    id: "planner-group-card",
    path: "/app/planner",
    search: TOUR_PLANNER_SEARCH,
    target: "planner-group-card",
    title: "Open a group.",
    body: "Clicking a box opens its details. This one is the oil refinery, which turns crude oil into plastic.",
    kind: "next",
  },
  {
    id: "planner-group-panel",
    path: "/app/planner",
    search: TOUR_PLANNER_SEARCH,
    target: "planner-group-panel",
    openedBy: "planner-group-card",
    title: "The details.",
    body: "How much the group makes against the most it could, its machines, and a button that lights up everything it feeds and needs. Close puts it away.",
    kind: "next",
  },
  {
    id: "map-canvas",
    path: "/app/map",
    target: "map-canvas",
    title: "The world.",
    body: "The game's map with the factory on it: its buildings, rails and trains, drone ports, the spots where ore and oil are dug up, and the player's own markers. Drag to move, scroll or pinch to zoom.",
    kind: "next",
  },
  // build PR 3: try-it (`done: { changes: "map-layer-toggle" }`, Do it for me toggles one).
  {
    id: "map-filters",
    path: "/app/map",
    target: "map-filters",
    title: "Choose what to see.",
    body: "Each box turns a layer of the map on or off. Belts, pipes and power lines start hidden; ticking one draws it.",
    kind: "next",
  },
  {
    id: "settings-alerts",
    path: "/app/settings",
    target: "settings-alerts",
    title: "Be told, don't watch.",
    body: "Each rule names a problem worth a message, such as a power outage or machines that stop, and can send it to a Discord chat, so the tab can stay closed.",
    kind: "next",
  },
  {
    id: "settings-connection",
    path: "/app/settings",
    target: "settings-connection",
    title: "Connecting a game.",
    body: "A small add-on on the game's computer sends its factory's data to this tool. This is where it is linked, and it says whether it is connected now.",
    kind: "next",
  },
  {
    id: "finish",
    path: "/app",
    target: "demo-banner-tour",
    title: "That's the tour.",
    body: "Restart it from this button any time. Everything resets when the page reloads.",
    kind: "next",
  },
];

/**
 * The tour's steps (ADR-0065 "The steps"). Each names its page (`path`, `search`), its target (an element with that
 * `data-tour`, demo/tour/target.ts) and its words, which must stand alone: a step whose target never appears is shown
 * centred with no highlight. `try` steps say how they are done by what appears or changes, never by reading a page's
 * state (tryIt.ts); the tour moves on by itself once they are.
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
   * A try-it step whose target takes no focus itself (the planner's card is drawn in SVG): the `data-tour` of its keyboard
   * path, which Tab reaches from the popover (ADR-0065 Decision 9). Otherwise Tab reaches the target, or what is inside it.
   */
  keyTarget?: string;
  /**
   * A target only clicks show, which the address cannot open (the planner's Graph view on a phone, its group panel): each
   * of these `data-tour`s in turn, once ready, is clicked as "Do it for me" would, unless the step's own target or a later
   * one is already there. Each must be an idempotent "show" (never a toggle that a second click undoes).
   */
  openedBy?: string | readonly string[];
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
    body: "This is a made-up factory from Satisfactory, a game about building factories. This tool watches a factory from outside the game. Nothing here is live data.",
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
    body: "Factories run on electricity, and running short stops everything. This chart compares power made with power used over the last few minutes, so you can see a shortage coming.",
    kind: "next",
  },
  {
    id: "power-circuits",
    path: "/app/power",
    target: "power-circuits",
    title: "What is a circuit?",
    body: "A circuit is one connected set of power plants and machines. Each card shows how much of its capacity is in use, so a strained one stands out.",
    kind: "next",
  },
  {
    id: "factory-machines",
    path: "/app/factory",
    target: "factory-machines",
    title: "Every machine at a glance.",
    body: "Every machine, grouped by factory. A machine stops when its inputs run out or its output is backed up. Each group counts the backed-up ones.",
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
    // A phone's planner opens on its Outline: Graph first (owner, 2026-11-06). On a wide screen the canvas is already there.
    openedBy: "planner-view-graph",
    title: "A map of the production.",
    body: "This is the Plastic line, one of the demo's factories. Each box is a group of machines; the lines show what feeds what, with the item's name at each end.",
    kind: "next",
  },
  {
    id: "planner-group-card",
    path: "/app/planner",
    search: TOUR_PLANNER_SEARCH,
    target: "planner-group-card",
    keyTarget: "planner-group-card-key",
    openedBy: "planner-view-graph",
    title: "Open a group.",
    body: "This box is the oil refinery, which turns crude oil into plastic. Try it: click the highlighted box to open its details.",
    kind: "try",
    done: { appears: "planner-group-panel" },
    doForMe: true,
  },
  {
    id: "planner-group-panel",
    path: "/app/planner",
    search: TOUR_PLANNER_SEARCH,
    target: "planner-group-panel",
    // Back from the map remounts the planner: on a phone that is the Outline again, so Graph first, then the card.
    openedBy: ["planner-view-graph", "planner-group-card"],
    title: "Inside a group.",
    body: "How much the group makes against the most it could, its machines, and a button that highlights everything it feeds or needs. Close puts it away.",
    kind: "next",
  },
  {
    id: "map-canvas",
    path: "/app/map",
    target: "map-canvas",
    title: "The world.",
    body: "The game's map with the factory on it: buildings, rails, trains, drone ports, ore and oil spots, and the player's markers. Drag to move, scroll or pinch to zoom.",
    kind: "next",
  },
  {
    id: "map-filters",
    path: "/app/map",
    // The one box the words ask for (Belts and pipes, hidden at first), so the highlight, the check and Do it for me agree.
    target: "map-layer-toggle",
    title: "Choose what to see.",
    body: "Each box turns a layer of the map on or off; belts, pipes and power lines start hidden. Try it: tick the highlighted box to draw the belts and pipes.",
    kind: "try",
    done: { changes: "map-layer-toggle" },
    doForMe: true,
  },
  {
    id: "settings-alerts",
    path: "/app/settings",
    target: "settings-alerts",
    title: "Be told, don't watch.",
    body: "Each rule, like this one for a power outage, names a problem worth a message and can send it to a Discord chat, so the tab can stay closed.",
    kind: "next",
  },
  {
    id: "settings-connection",
    path: "/app/settings",
    target: "settings-connection",
    title: "Connecting a game.",
    body: "A small add-on on the game's computer sends its factory's data to this tool. These lines say whether it is linked and online now.",
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

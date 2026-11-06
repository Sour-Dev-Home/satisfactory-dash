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
}

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
];

/**
 * The `data-tour` of a page's tab in the top nav (`tab-overview`, `tab-power`, ...), which the shell spreads on each
 * NavLink with `tour(...)` (target.ts): the tour cuts a second, quieter hole round the tab of the step's page (ADR-0065
 * amendment, 2026-11-07). Its own module, with no build-time constant, so the e2e specs can import it.
 */
/** The class the shell puts on its tab row in the demo build only; index.css pins it while the tour runs. */
export const TOUR_PIN_CLASS = "tour-pin";
/** Set on <html> while the tour runs, which turns the pin on (no `data-tour` in it: that marker must stay out of production). */
export const TOUR_ACTIVE_ATTR = "data-guided-tour";

export function tabTarget(path: string): string {
  const page = path.replace(/\/+$/, "").split("/").at(-1);
  return `tab-${page === undefined || page === "app" || page === "" ? "overview" : page}`;
}

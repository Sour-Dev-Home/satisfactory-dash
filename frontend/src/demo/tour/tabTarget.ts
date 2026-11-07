/**
 * The `data-tour` of a page's tab in the top nav (`tab-overview`, `tab-power`, ...), which the shell spreads on each
 * NavLink with `tour(...)` (target.ts): the tour cuts a second, quieter hole round the tab of the step's page (ADR-0065
 * amendment, 2026-11-07). Its own module, with no build-time constant, so the e2e specs can import it.
 */
export function tabTarget(path: string): string {
  const page = path.replace(/\/+$/, "").split("/").at(-1);
  return `tab-${page === undefined || page === "app" || page === "" ? "overview" : page}`;
}

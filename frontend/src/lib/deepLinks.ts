/**
 * Links into part of a page (#351, the owner's decision (c), 2026-09-27), for the command bar and
 * anything else that wants to point at one machine, item or circuit. Every one is an absolute /app
 * path (frontend/CLAUDE.md); the pages read them back with the parsers below.
 */

/** The Factory page's machine search, and the production history's picked item (a class name). */
export const FACTORY_SEARCH_PARAM = "q";
export const FACTORY_ITEM_PARAM = "item";
/** The machine table's state filters (ADR-0062 F.3): a comma list of `FACTORY_STATE_FILTERS`, e.g. `?state=backedUp,paused`. */
export const FACTORY_STATE_PARAM = "state";
/** The state filters, in the order they show and are written; none on is "All". */
export const FACTORY_STATE_FILTERS = ["backedUp", "paused", "noRecipe"] as const;
export type FactoryStateFilter = (typeof FACTORY_STATE_FILTERS)[number];
/** The production history section's id on the Factory page. */
export const HISTORY_ANCHOR = "history";
/** The machine table's section id on the Factory page (its in-page nav, ADR-0062 F.4). */
export const MACHINES_ANCHOR = "machines";

/** A circuit card's id on the Power page. */
export const circuitAnchor = (circuitGroupId: number): string => `circuit-${circuitGroupId}`;
export const isCircuitAnchor = (id: string): boolean => /^circuit-\d+$/.test(id);

/** The Factory page with its machine search filled in. */
export function factorySearchLink(search: string): string {
  return `/app/factory?${new URLSearchParams({ [FACTORY_SEARCH_PARAM]: search })}`;
}

/** The Factory page's production history, showing one item (by its class name). */
export function itemHistoryLink(itemClass: string): string {
  return `/app/factory?${new URLSearchParams({ [FACTORY_ITEM_PARAM]: itemClass })}#${HISTORY_ANCHOR}`;
}

/** The Power page, scrolled to one circuit. */
export function circuitLink(circuitGroupId: number): string {
  return `/app/power#${circuitAnchor(circuitGroupId)}`;
}

/**
 * A search from the URL, as typed (it drives the search box, so a space mid-word must survive; the
 * table trims when it filters), capped at 100 characters, empty when absent.
 */
export function readSearch(params: URLSearchParams): string {
  const capped = (params.get(FACTORY_SEARCH_PARAM) ?? "").slice(0, 100);
  // slice() counts UTF-16 code units, so a cap can land inside a surrogate pair (an emoji, etc.):
  // drop a trailing lone high surrogate rather than hand the search box half a character.
  const last = capped.charCodeAt(capped.length - 1);
  return last >= 0xd800 && last <= 0xdbff ? capped.slice(0, -1) : capped;
}

/**
 * The state filters from the URL, in `FACTORY_STATE_FILTERS` order with no repeats. Takes a comma list and also a repeated
 * parameter (`?state=backedUp&state=paused`, as a hand-written link might be); an unknown value is dropped, never a guess.
 */
export function readStates(params: URLSearchParams): FactoryStateFilter[] {
  const asked = new Set(params.getAll(FACTORY_STATE_PARAM).flatMap((value) => value.split(",").map((s) => s.trim())));
  return FACTORY_STATE_FILTERS.filter((state) => asked.has(state));
}

/** The `?state=` value for these filters (comma list, canonical order), or undefined for none ("All": no parameter). */
export function writeStates(states: readonly FactoryStateFilter[]): string | undefined {
  const on = FACTORY_STATE_FILTERS.filter((state) => states.includes(state));
  return on.length === 0 ? undefined : on.join(",");
}

/** An item class from the URL, or undefined when absent or not a plausible class name. */
export function readItem(params: URLSearchParams): string | undefined {
  const item = params.get(FACTORY_ITEM_PARAM)?.trim();
  return item && /^[A-Za-z0-9_]{1,200}$/.test(item) ? item : undefined;
}

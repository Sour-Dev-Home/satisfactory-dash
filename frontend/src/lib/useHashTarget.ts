import { useEffect, useRef } from "react";

/** The id a URL fragment names ("#circuit-3" → "circuit-3"), or undefined for none or a malformed one. */
export function hashId(hash: string): string | undefined {
  if (hash.length < 2 || !hash.startsWith("#")) return undefined;
  try {
    return decodeURIComponent(hash.slice(1));
  } catch {
    return undefined;
  }
}

/**
 * Deep links to part of a page (#351's deep links, e.g. /app/power#circuit-3): once the element the
 * URL's fragment names is on screen, scroll to it and focus it (a heading-like target gets
 * tabIndex -1), once per navigation. `accepts` says which ids this component renders, so each
 * section only handles its own. Reads `window.location` rather than the router, so a view works the
 * same inside or outside one; it runs after every render (a check, not a subscription) and stops at
 * the first match, so data that lands later still gets its jump, and a poll's re-render never
 * steals focus again.
 */
export function useHashTarget(accepts: (id: string) => boolean): void {
  const handled = useRef<string>(undefined);
  useEffect(() => {
    const id = hashId(window.location.hash);
    if (!id || !accepts(id)) return;
    // One jump per navigation: the router stores a key for each history entry.
    const entry = `${(window.history.state as { key?: string } | null)?.key ?? ""}${window.location.hash}`;
    if (handled.current === entry) return;
    const target = document.getElementById(id);
    if (!target) return;
    handled.current = entry;
    if (!target.hasAttribute("tabindex") && target.tabIndex < 0) target.setAttribute("tabindex", "-1");
    target.scrollIntoView?.({ block: "start" });
    target.focus({ preventScroll: true });
  });
}

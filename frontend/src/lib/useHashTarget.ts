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
    // One jump per navigation: react-router's history keeps `idx` for the current history entry
    // (it only bumps `idx` on a push; a replace, e.g. typing in a search box that keeps its pick in
    // the URL, reuses the same `idx` even though it hands out a fresh `key` every time). Keying off
    // `key` instead would re-run this jump on every such replace and steal focus back from whatever
    // the user is doing.
    const entry = `${(window.history.state as { idx?: number } | null)?.idx ?? ""}${window.location.hash}`;
    if (handled.current === entry) return;
    const target = document.getElementById(id);
    if (!target) return;
    handled.current = entry;
    target.scrollIntoView?.({ block: "start" });
    // A whole section (a page-wide panel) takes focus on its heading, so the focus ring outlines the
    // heading rather than a panel the size of the screen (ui review); a card takes it itself. Either
    // way a keyboard user sees where they landed (WCAG 2.4.7).
    const focusable = (target.tagName === "SECTION" && target.querySelector<HTMLElement>("h2, h3")) || target;
    if (!focusable.hasAttribute("tabindex") && focusable.tabIndex < 0) focusable.setAttribute("tabindex", "-1");
    focusable.focus({ preventScroll: true });
  });
}

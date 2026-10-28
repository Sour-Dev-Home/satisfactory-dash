import { useCallback, useLayoutEffect, useRef, useState } from "react";

export interface RowCap<T> {
  /** The rows to render: the first `cap` while capped, all of them once shown. */
  visible: readonly T[];
  /** How many rows there are in all, capped or not. */
  total: number;
  cap: number;
  /** More rows than the cap, so the list has a "Show all" control at all. */
  overCap: boolean;
  /** "Show all" was pressed and nothing has reset it since. */
  expanded: boolean;
  showAll: () => void;
  showFewer: () => void;
  /** For the first row past the cap: takes focus once "Show all" reveals it, so the reader carries on where the list stopped. */
  firstRevealedRef: (el: HTMLElement | null) => void;
  /** For the toggle: kept in view when "Show fewer" shortens the list under it. */
  toggleRef: (el: HTMLElement | null) => void;
}

/**
 * ADR-0062 F.5: a list's first render capped at `cap` rows, then "Show all", so the page height is bounded. Apply it after
 * filtering, so a search still reaches every row. A new `resetKey` (the filter and search the rows came from) caps the
 * list again: "Show all" was a choice about that list, not the next one. The reset happens in render, before commit, so
 * the capped list never paints a frame at full length (ADR-0032's shift budget). One hook per list: F.2 gives each group its own.
 */
export function useRowCap<T>(rows: readonly T[], cap: number, resetKey: string): RowCap<T> {
  const [expanded, setExpanded] = useState(false);
  const [seenKey, setSeenKey] = useState(resetKey);
  if (resetKey !== seenKey) {
    setSeenKey(resetKey);
    setExpanded(false);
  }
  const focusRevealed = useRef(false);
  const keepToggleInView = useRef(false);
  const toggle = useRef<HTMLElement | null>(null);

  const showAll = useCallback(() => {
    focusRevealed.current = true;
    setExpanded(true);
  }, []);
  const showFewer = useCallback(() => {
    keepToggleInView.current = true;
    setExpanded(false);
  }, []);
  // Stable, so a re-render (the 30 s poll) doesn't re-run it: focus moves once, right after "Show all".
  const firstRevealedRef = useCallback((el: HTMLElement | null) => {
    if (el && focusRevealed.current) {
      focusRevealed.current = false;
      el.focus();
    }
  }, []);
  const toggleRef = useCallback((el: HTMLElement | null) => {
    toggle.current = el;
  }, []);
  // After "Show fewer" the rows under the reader are gone and the toggle (still focused) has moved up: bring it back.
  useLayoutEffect(() => {
    if (!keepToggleInView.current) return;
    keepToggleInView.current = false;
    toggle.current?.scrollIntoView?.({ block: "nearest" });
  }, [expanded]);

  const overCap = rows.length > cap;
  return {
    visible: overCap && !expanded ? rows.slice(0, cap) : rows,
    total: rows.length,
    cap,
    overCap,
    expanded,
    showAll,
    showFewer,
    firstRevealedRef,
    toggleRef,
  };
}

import { useCallback, useSyncExternalStore } from "react";

/** Where the graph is the default view (ADR-0050 Decision 4): from the `sm` breakpoint up; a phone defaults to the tables. */
const WIDE_QUERY = "(min-width: 640px)";
/** Tailwind's `lg` (64rem): from here the canvas's floating card stands beside the clicked card, below it lies across the bottom. */
const LARGE_QUERY = "(min-width: 64rem)";
const media = (query: string) => (typeof window !== "undefined" && typeof window.matchMedia === "function" ? window.matchMedia(query) : null);

function useMedia(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const list = media(query);
      list?.addEventListener("change", onChange);
      return () => list?.removeEventListener("change", onChange);
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () => media(query)?.matches ?? false,
    () => false,
  );
}

/** Whether the screen is wide enough for the graph to be the default. Without matchMedia (jsdom) it is not: tables first. */
export function useWideScreen(): boolean {
  return useMedia(WIDE_QUERY);
}

/** Whether the screen is at least `lg`. Without matchMedia (jsdom) it is not. */
export function useLargeScreen(): boolean {
  return useMedia(LARGE_QUERY);
}

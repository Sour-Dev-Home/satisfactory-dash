import { useSyncExternalStore } from "react";

/** Where the graph is the default view (ADR-0050 Decision 4): from the `sm` breakpoint up; a phone defaults to the tables. */
const WIDE_QUERY = "(min-width: 640px)";
const media = () => (typeof window !== "undefined" && typeof window.matchMedia === "function" ? window.matchMedia(WIDE_QUERY) : null);

function subscribe(onChange: () => void): () => void {
  const list = media();
  list?.addEventListener("change", onChange);
  return () => list?.removeEventListener("change", onChange);
}

/** Whether the screen is wide enough for the graph to be the default. Without matchMedia (jsdom) it is not: tables first. */
export function useWideScreen(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => media()?.matches ?? false,
    () => false,
  );
}

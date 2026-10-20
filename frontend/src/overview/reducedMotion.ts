import { useSyncExternalStore } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

/** The media query, or null where the browser has none (jsdom, very old engines): motion is then allowed. */
const media = () => (typeof window !== "undefined" && typeof window.matchMedia === "function" ? window.matchMedia(QUERY) : null);

function subscribe(onChange: () => void): () => void {
  const list = media();
  list?.addEventListener("change", onChange);
  return () => list?.removeEventListener("change", onChange);
}

/**
 * Whether the operator asked for reduced motion. index.css already zeroes every motion token then;
 * a component reads this too when it should not even start an animation (the circuit strip, #442),
 * so its still state is the same one a 0 MW circuit shows.
 */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => media()?.matches ?? false,
    () => false,
  );
}

import { useCallback, useState } from "react";

/**
 * A disclosure tree's open and closed state (`Disclosure.tsx`): the viewer's choices as explicit open or closed values,
 * never "flipped from the default", since a default can change under a poll (a factory crossing the outline's 20 groups)
 * and must not turn the viewer's choice over. Keys are UI-only strings, held in a Map.
 */
export function useDisclosures(defaultOf: (key: string) => boolean): { isOpen: (key: string) => boolean; toggle: (key: string) => void } {
  const [chosen, setChosen] = useState<ReadonlyMap<string, boolean>>(() => new Map());
  const isOpen = useCallback((key: string) => chosen.get(key) ?? defaultOf(key), [chosen, defaultOf]);
  const toggle = useCallback((key: string) => setChosen((prev) => new Map(prev).set(key, !(prev.get(key) ?? defaultOf(key)))), [defaultOf]);
  return { isOpen, toggle };
}

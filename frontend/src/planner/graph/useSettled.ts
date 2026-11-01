import { useEffect, useState } from "react";

/**
 * The value once it has stopped changing for `ms` (by identity): the first render's value at once, then each later one after
 * a quiet `ms`. The marching dashes choose their lines from the settled view, so a pan or a pinch costs no work per frame.
 */
export function useSettled<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    if (Object.is(value, settled)) return;
    const timer = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(timer);
  }, [value, settled, ms]);
  return settled;
}

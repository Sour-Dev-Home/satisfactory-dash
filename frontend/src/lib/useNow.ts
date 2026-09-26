import { useEffect, useState } from "react";

/** The current time, re-read every `everyMs` so relative times ("8 s ago") keep counting. */
export function useNow(everyMs = 1000): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(timer);
  }, [everyMs]);
  return now;
}

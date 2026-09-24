import { useEffect, useState } from "react";

/**
 * "Dismiss until it changes" for the Overview's warnings banner (the owner's call). What's
 * stored is the warningKey that was dismissed, per server, in this browser only: a UI
 * preference, nothing to do with auth. Storage can be missing or throw (private mode,
 * blocked site data), and then the banner simply isn't dismissed.
 */
const storageKey = (serverId: string) => `satis-manager.dismissed-warning.${serverId}`;

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null): void {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    // Not remembered across reloads; this page still hides it (state below).
  }
}

export function useDismissedWarning(
  serverId: string,
  warning: string,
  allClear: boolean,
): { hidden: boolean; dismiss: () => void } {
  const key = storageKey(serverId);
  const [stored, setStored] = useState(() => ({ key, value: read(key) }));
  // A different server (the view can stay mounted): its own dismissal, read during render.
  if (stored.key !== key) setStored({ key, value: read(key) });

  // Back to all clear: forget the dismissal, so the next warning always shows, even the same
  // one. The state during render, the storage (the external system) in an effect.
  if (allClear && stored.key === key && stored.value !== null) setStored({ key, value: null });
  useEffect(() => {
    if (allClear) write(key, null);
  }, [allClear, key]);

  return {
    hidden: stored.key === key && stored.value !== null && stored.value === warning,
    dismiss: () => {
      write(key, warning);
      setStored({ key, value: warning });
    },
  };
}

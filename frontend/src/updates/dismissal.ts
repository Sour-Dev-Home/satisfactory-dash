import { useState } from "react";
import type { ClientKind } from "./notices";

/**
 * "Update available" can be dismissed per release (ADR-0057 Decision 7): what is stored is the `current` version that
 * was dismissed, per server and component, in this browser only. A newer release brings the banner back. Advisories and
 * unsupported versions are never dismissible. Storage can be missing or throw (private mode, blocked site data); then
 * the banner is hidden for this page view only.
 */
const storageKey = (serverId: string, kind: ClientKind) => `satis-manager.dismissed-update.${serverId}.${kind}`;

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Not remembered across reloads; the state below still hides it for now.
  }
}

export function useDismissedUpdate(serverId: string, kind: ClientKind, current: string): { hidden: boolean; dismiss: () => void } {
  const key = storageKey(serverId, kind);
  const [stored, setStored] = useState(() => ({ key, value: read(key) }));
  // A different server (the shell stays mounted): its own dismissal, read during render.
  if (stored.key !== key) setStored({ key, value: read(key) });
  return {
    hidden: stored.key === key && stored.value === current,
    dismiss: () => {
      write(key, current);
      setStored({ key, value: current });
    },
  };
}

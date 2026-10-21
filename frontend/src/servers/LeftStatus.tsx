import { useCallback, useEffect, useRef } from "react";
import { useLocation } from "react-router";

/**
 * "You left {name}." (ADR-0047): the confirmation after leaving a server, on whatever screen ServerGate lands on next
 * (the next server's page when one is selected automatically, the picker, or the no-server screen). A polite live
 * region; with `focus` it also takes focus, since the control that was used is gone. It goes away once the person moves
 * to another page (`onDone`).
 */
export function LeftStatus({ name, focus = false, onDone }: { name: string; focus?: boolean; onDone?: () => void }) {
  const focusIn = useCallback((el: HTMLElement | null) => el?.focus(), []);
  const { pathname } = useLocation();
  const shownOn = useRef(pathname);
  useEffect(() => {
    if (pathname !== shownOn.current) onDone?.();
  }, [pathname, onDone]);
  return (
    <p
      role="status"
      aria-live="polite"
      ref={focus ? focusIn : undefined}
      tabIndex={focus ? -1 : undefined}
      className="mb-0 animate-reveal rounded-card border border-ok bg-ok-soft p-3 text-sm"
    >
      You left {name}.
    </p>
  );
}

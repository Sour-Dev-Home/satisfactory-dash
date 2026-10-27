import { useEffect, useRef, useState } from "react";
import { UNDO_MS, useDesignationChanges } from "./designationChanges";

/**
 * The undo offer (ADR-0055 Decision 12, #727): non-modal, at the foot of the planner while it is in view (ADR-0016 item
 * 8). It takes the focus when a change offers an undo (the cards it came from are gone), and hands it to the planner's
 * heading once there is nothing left to press. Hidden after UNDO_MS, but never while the pointer or the focus is on it
 * (WCAG 2.2.1). The result is also said through a polite live region that is always there.
 */
export function UndoToast() {
  const changes = useDesignationChanges();
  const [held, setHeld] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const shown = changes?.shown ?? null;
  const dismiss = changes?.dismiss;
  const shownKey = shown?.key;
  const offersUndo = shown?.undo !== undefined;
  // Only a new result moves the focus. A removed button fires no blur, so the hold starts over with each result.
  const [focusedKey, setFocusedKey] = useState<number | undefined>(undefined);
  if (shownKey !== focusedKey) {
    setFocusedKey(shownKey);
    setHeld(false);
  }
  useEffect(() => {
    if (shownKey === undefined) return;
    if (offersUndo) button.current?.focus();
    else if (box.current?.contains(document.activeElement) === true || document.activeElement === document.body) {
      document.getElementById("planner-heading")?.focus();
    }
  }, [shownKey, offersUndo]);
  useEffect(() => {
    if (shown === null || held || dismiss === undefined) return;
    const timer = setTimeout(dismiss, UNDO_MS);
    return () => clearTimeout(timer);
  }, [shown, held, dismiss]);
  if (changes === null) return null;
  return (
    <>
      <div aria-live="polite" className="sr-only">
        {changes.announcement}
      </div>
      {shown !== null && (
        <div
          ref={box}
          data-undo-toast=""
          onFocus={() => setHeld(true)}
          onBlur={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget)) setHeld(false);
          }}
          onPointerEnter={() => setHeld(true)}
          onPointerLeave={() => setHeld(false)}
          className="sticky bottom-4 z-(--z-popover) flex flex-wrap items-center gap-3 rounded-card border border-info-edge bg-surface-2 p-3 shadow-lg"
        >
          <p id="planner-undo-message" className="m-0 min-w-0 flex-1 break-words text-sm">
            {shown.message}
          </p>
          {shown.undo !== undefined && (
            <button
              ref={button}
              type="button"
              disabled={changes.undoing}
              aria-describedby="planner-undo-message"
              onClick={() => void changes.undo()}
              className="min-h-touch"
            >
              {shown.undo.label}
            </button>
          )}
          <button type="button" onClick={changes.dismiss} className="min-h-touch">
            Dismiss
          </button>
        </div>
      )}
    </>
  );
}

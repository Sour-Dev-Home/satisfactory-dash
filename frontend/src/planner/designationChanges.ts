import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import type { PlannerDesignation, ReplacePlannerDesignationsRequest, ReplacePlannerDesignationsResponse } from "@satisfactory-dash/shared";
import { isStaleDesignation } from "../api/plannerWrites";
import { undoRequest } from "./designationOps";
import { STALE_TEXT, designationErrorText } from "./designationText";

/**
 * ADR-0055 Decision 12 (#727): runs merge, split, pop-out and dissolve, and offers each one's undo for a while ("Split
 * back" after a merge; `UndoToast.tsx` shows it). The undo lives in this page's memory only: the pre-image as it was read
 * plus the response's revisions; it is never stored on the server. A stale undo never overwrites: it says so and the page
 * re-reads.
 */

/** How long the undo stays offered, unless the pointer or the focus is on it (then it waits: WCAG 2.2.1). */
export const UNDO_MS = 10_000;

/** A request ready to send, with the designations it replaces as read (what undo restores). */
export interface ReadyChange {
  request: ReplacePlannerDesignationsRequest;
  preImage: PlannerDesignation[];
}

export interface ChangeWords {
  /** Said and shown once it is done, e.g. "Merged 2 factories into Iron works." */
  message: string;
  /** The toast's button. */
  undoLabel: "Split back" | "Undo";
}

export interface ShownChange {
  key: number;
  message: string;
  undo?: { label: string; preImage: PlannerDesignation[]; response: ReplacePlannerDesignationsResponse };
}

export interface DesignationChanges {
  /** Sends the change; throws (the caller shows why) and, on `designation_stale`, the reads are already refetching. */
  apply: (change: ReadyChange, words: ChangeWords) => Promise<void>;
  shown: ShownChange | null;
  undoing: boolean;
  undo: () => Promise<void>;
  dismiss: () => void;
  /** The polite announcement of the last result, for the page's live region. */
  announcement: string;
}

export const DesignationChangeContext = createContext<DesignationChanges | null>(null);
export const useDesignationChanges = (): DesignationChanges | null => useContext(DesignationChangeContext);

export const SPLIT_BACK_DONE = "Split back: the factories are as they were.";
export const UNDO_DONE = "Undone: the factories are as they were.";

/** The page's change runner over the replace write (null for a viewer); one change, and its one undo, at a time. */
export function useDesignationChangeRunner(
  replace: ((body: ReplacePlannerDesignationsRequest) => Promise<ReplacePlannerDesignationsResponse>) | null,
): DesignationChanges | null {
  const [shown, setShown] = useState<ShownChange | null>(null);
  const [undoing, setUndoing] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const counter = useRef(0);
  const show = useCallback((next: Omit<ShownChange, "key">) => {
    counter.current += 1;
    setShown({ ...next, key: counter.current });
    setAnnouncement(next.message);
  }, []);
  const apply = useCallback(
    async (change: ReadyChange, words: ChangeWords) => {
      if (replace === null) return;
      const response = await replace(change.request);
      show({ message: words.message, undo: { label: words.undoLabel, preImage: change.preImage, response } });
    },
    [replace, show],
  );
  const undo = useCallback(async () => {
    const offered = shown?.undo;
    if (replace === null || offered === undefined) return;
    const inverse = undoRequest(offered.preImage, offered.response);
    if (!inverse.ok) {
      show({ message: inverse.reason });
      return;
    }
    setUndoing(true);
    try {
      await replace(inverse.request);
      show({ message: offered.label === "Split back" ? SPLIT_BACK_DONE : UNDO_DONE });
    } catch (error) {
      // A stale undo is over (someone changed them meanwhile, and the page re-reads); anything else can be tried again.
      if (isStaleDesignation(error)) show({ message: STALE_TEXT });
      else show({ message: designationErrorText(error), undo: offered });
    } finally {
      setUndoing(false);
    }
  }, [replace, shown, show]);
  const dismiss = useCallback(() => setShown(null), []);
  return useMemo(
    () => (replace === null ? null : { apply, shown, undoing, undo, dismiss, announcement }),
    [replace, apply, shown, undoing, undo, dismiss, announcement],
  );
}

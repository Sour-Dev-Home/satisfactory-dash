import type { RowCap } from "./useRowCap";

/**
 * Under a capped list (ADR-0062 F.5): how many rows show, and the one control that shows the rest or the first `cap`
 * again. The count is a status line, so a screen reader hears "Showing all 385 machines" when the list grows. Nothing
 * when the list fits under the cap.
 */
export function ShowAllRows<T>({ rowCap, noun }: { rowCap: RowCap<T>; noun: string }) {
  const { overCap, expanded, total, cap, visible, showAll, showFewer, toggleRef } = rowCap;
  if (!overCap) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <p role="status" className="mb-0 text-sm text-muted">
        {expanded ? `Showing all ${total} ${noun}.` : `Showing ${visible.length} of ${total} ${noun}.`}
      </p>
      <button ref={toggleRef} type="button" onClick={expanded ? showFewer : showAll}>
        {expanded ? `Show only the first ${cap}` : `Show all ${total} ${noun}`}
      </button>
    </div>
  );
}

import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DesignationChangeContext, UNDO_MS, type DesignationChanges, type ShownChange } from "./designationChanges";
import { UndoToast } from "./UndoToast";

const shownWithUndo: ShownChange = { key: 1, message: "Merged 2 factories into Works.", undo: { label: "Split back", preImage: [], response: { designations: [], removedIds: [] } } };

function setup(shown: ShownChange | null = shownWithUndo) {
  const changes: DesignationChanges = { apply: vi.fn(), shown, undoing: false, undo: vi.fn(() => Promise.resolve()), dismiss: vi.fn(), announcement: shown?.message ?? "" };
  const view = render(
    <>
      <h3 id="planner-heading" tabIndex={-1}>
        Production planner
      </h3>
      <button type="button">Elsewhere</button>
      <DesignationChangeContext value={changes}>
        <UndoToast />
      </DesignationChangeContext>
    </>,
  );
  return { changes, view };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("UndoToast", () => {
  it("renders nothing for a viewer (no change runner)", () => {
    const { container } = render(<UndoToast />);
    expect(container).toBeEmptyDOMElement();
  });

  it("focuses its undo button, says the result in a live region, and runs undo", () => {
    const { changes } = setup();
    const button = screen.getByRole("button", { name: "Split back" });
    expect(button).toHaveFocus();
    expect(button).toHaveAccessibleDescription("Merged 2 factories into Works.");
    expect(document.querySelector("[aria-live=polite]")).toHaveTextContent("Merged 2 factories into Works.");
    fireEvent.click(button);
    expect(changes.undo).toHaveBeenCalledOnce();
  });

  it("waits while the focus is on it, then hides UNDO_MS after the focus leaves", () => {
    const { changes } = setup();
    act(() => vi.advanceTimersByTime(UNDO_MS * 2));
    expect(changes.dismiss).not.toHaveBeenCalled();
    act(() => screen.getByRole("button", { name: "Elsewhere" }).focus());
    act(() => vi.advanceTimersByTime(UNDO_MS - 1));
    expect(changes.dismiss).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(changes.dismiss).toHaveBeenCalledOnce();
  });

  it("waits while the pointer is over it", () => {
    const { changes } = setup();
    act(() => screen.getByRole("button", { name: "Elsewhere" }).focus());
    const toast = document.querySelector("[data-undo-toast]")!;
    fireEvent.pointerEnter(toast);
    act(() => vi.advanceTimersByTime(UNDO_MS * 2));
    expect(changes.dismiss).not.toHaveBeenCalled();
    fireEvent.pointerLeave(toast);
    act(() => vi.advanceTimersByTime(UNDO_MS));
    expect(changes.dismiss).toHaveBeenCalledOnce();
  });

  it("a result with nothing to press hands the focus to the planner's heading, and Dismiss closes it", () => {
    const { changes } = setup({ key: 2, message: "Split back: the factories are as they were." });
    expect(screen.queryByRole("button", { name: /Split back|Undo/ })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Production planner" })).toHaveFocus();
    act(() => screen.getByRole("button", { name: "Dismiss" }).focus());
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(changes.dismiss).toHaveBeenCalled();
    expect(screen.getByRole("heading", { name: "Production planner" })).toHaveFocus();
  });
});

import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { COPIED_MS, CopyButton } from "./CopyButton";

const writeText = vi.fn<(text: string) => Promise<void>>();

beforeEach(() => {
  vi.useFakeTimers();
  writeText.mockReset().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
});
afterEach(() => {
  vi.useRealTimers();
  Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
});

const click = async () => {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Copy the code" }));
  });
};
const visible = (icon: string) => document.querySelector(`[data-icon="${icon}"]`)?.getAttribute("data-visible");

describe("CopyButton", () => {
  it("is named by its label, and shows the copy icon", () => {
    render(<CopyButton text="AB3D-7XQ2" label="Copy the code" />);
    expect(screen.getByRole("button", { name: "Copy the code" })).toBeInTheDocument();
    expect(visible("copy")).toBe("true");
    expect(visible("check")).toBe("false");
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });

  it("copies the text, swaps to a check and says Copied, then goes back", async () => {
    render(<CopyButton text="AB3D-7XQ2" label="Copy the code" />);
    await click();
    expect(writeText).toHaveBeenCalledWith("AB3D-7XQ2");
    expect(visible("check")).toBe("true");
    expect(visible("copy")).toBe("false");
    expect(screen.getByRole("status")).toHaveTextContent("Copied");

    act(() => vi.advanceTimersByTime(COPIED_MS));
    expect(visible("copy")).toBe("true");
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });

  it("says it couldn't copy when the browser refuses", async () => {
    writeText.mockRejectedValue(new Error("denied"));
    render(<CopyButton text="AB3D-7XQ2" label="Copy the code" />);
    await click();
    expect(screen.getByRole("status")).toHaveTextContent(/Couldn't copy/);
    expect(visible("check")).toBe("false");
  });

  it("says it couldn't copy on a page with no clipboard (not a secure page)", async () => {
    Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
    render(<CopyButton text="AB3D-7XQ2" label="Copy the code" />);
    await click();
    expect(screen.getByRole("status")).toHaveTextContent(/Couldn't copy/);
  });

  it("restarts the wait on a second click, and stops its timer when it goes away", async () => {
    const { unmount } = render(<CopyButton text="AB3D-7XQ2" label="Copy the code" />);
    await click();
    act(() => vi.advanceTimersByTime(COPIED_MS - 100));
    await click();
    act(() => vi.advanceTimersByTime(COPIED_MS - 100));
    expect(visible("check")).toBe("true");
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});

import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DataAge } from "./DataAge";

const at = "2026-09-22T22:25:04.000Z";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(Date.parse(at) + 8_000);
});
afterEach(() => vi.useRealTimers());

describe("DataAge", () => {
  it("shows how old the data is, with the exact time on the <time> element", () => {
    render(<DataAge observedAt={at} late={false} />);
    const time = screen.getByText("Updated 8 s ago");
    expect(time.tagName).toBe("TIME");
    expect(time).toHaveAttribute("dateTime", at);
    expect(time).toHaveAttribute("title", new Date(at).toLocaleString());
    expect(screen.queryByText(/overdue/)).not.toBeInTheDocument();
  });

  it("keeps counting each second", () => {
    render(<DataAge observedAt={at} late={false} />);
    act(() => vi.advanceTimersByTime(13_000));
    expect(screen.getByText("Updated 21 s ago")).toBeInTheDocument();
  });

  it("warns only when told the data is late, however old this clock says it is", () => {
    // A PC clock an hour ahead: the age text follows it, the warning doesn't.
    vi.setSystemTime(Date.parse(at) + 3_600_000);
    const { rerender } = render(<DataAge observedAt={at} late={false} />);
    expect(screen.getByText(/^Updated 1 h /)).toBeInTheDocument();
    expect(screen.queryByText(/overdue/)).not.toBeInTheDocument();
    expect(screen.getByText(/^Updated 1 h /).closest("[data-age]")).not.toHaveClass("text-warn");

    rerender(<DataAge observedAt={at} late />);
    expect(screen.getByText(/newer data is overdue/)).toBeInTheDocument();
    expect(screen.getByText(/^Updated 1 h /).closest("[data-age]")).toHaveClass("text-warn");
  });

  it("isn't a live region: it changes every second", () => {
    const { container } = render(<DataAge observedAt={at} late={false} />);
    expect(container.querySelector("[role], [aria-live]")).toBeNull();
  });

  it("stops its timer when it goes away", () => {
    const { unmount } = render(<DataAge observedAt={at} late={false} />);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});

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
    render(<DataAge observedAt={at} pollMs={10_000} />);
    const time = screen.getByText("Updated 8 s ago");
    expect(time.tagName).toBe("TIME");
    expect(time).toHaveAttribute("dateTime", at);
    expect(time).toHaveAttribute("title", new Date(at).toLocaleString());
    expect(screen.queryByText(/overdue/)).not.toBeInTheDocument();
  });

  it("keeps counting, and warns once newer data is overdue (past twice the poll interval)", () => {
    render(<DataAge observedAt={at} pollMs={10_000} />);
    act(() => vi.advanceTimersByTime(12_000));
    expect(screen.getByText("Updated 20 s ago")).toBeInTheDocument();
    expect(screen.queryByText(/overdue/)).not.toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1_000));
    expect(screen.getByText("Updated 21 s ago")).toBeInTheDocument();
    expect(screen.getByText(/newer data is overdue/)).toBeInTheDocument();
    expect(screen.getByText("Updated 21 s ago").closest("[data-age]")).toHaveClass("text-warn");
  });

  it("isn't a live region: it changes every second", () => {
    const { container } = render(<DataAge observedAt={at} pollMs={10_000} />);
    expect(container.querySelector("[role], [aria-live]")).toBeNull();
  });

  it("stops its timer when it goes away", () => {
    const { unmount } = render(<DataAge observedAt={at} pollMs={10_000} />);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});

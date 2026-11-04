import { render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgeBadge } from "./AgeBadge";

// The page's freshness badge (#616; beside the server picker since ADR-0064 Decision 6).
describe("AgeBadge", () => {
  const OBSERVED = "2026-09-22T22:25:00.000Z";
  const at = (seconds: number) => new Date(Date.parse(OBSERVED) + seconds * 1000);
  const renderAt = (seconds: number, late = false) => {
    vi.useFakeTimers({ now: at(seconds) });
    return render(<AgeBadge observedAt={OBSERVED} late={late} />).container.querySelector("[data-age]")!;
  };
  afterEach(() => vi.useRealTimers());

  it.each([
    [3, "live"],
    [14, "live"],
    [15, "< 1 min"],
    [59, "< 1 min"],
    [60, "1 min"],
    [200, "3 min"],
  ])("reads %d s old as %s", (seconds, label) => {
    expect(renderAt(seconds).querySelector("[data-age-label]")).toHaveTextContent(label);
  });

  it("keeps the exact age as accessible text and a tooltip", () => {
    const badge = renderAt(8);
    expect(badge.querySelector("time")).toHaveClass("sr-only");
    // "Data …": beside the server picker it must not read as the server's state.
    expect(badge.querySelector("time")).toHaveTextContent("Data updated 8 s ago");
    expect(badge).toHaveAttribute("title", expect.stringContaining("Data updated 8 s ago"));
  });

  it("turns amber and says so when the backend calls the data late", () => {
    const badge = renderAt(8, true);
    expect(badge).toHaveClass("text-warn");
    expect(badge.querySelector("[data-age-label]")).toHaveTextContent("late");
    expect(badge).toHaveTextContent("newer data is overdue");
  });
});

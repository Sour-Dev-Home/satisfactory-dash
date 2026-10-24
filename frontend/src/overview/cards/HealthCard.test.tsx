import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HealthCard } from "./HealthCard";

describe("HealthCard", () => {
  it("is a card with its own heading, announcing the state and headline as a status", () => {
    render(<HealthCard overall={{ health: "ok", headline: "All systems operational" }} />);
    expect(screen.getByRole("region", { name: "Health" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("OperationalAll systems operational");
  });

  const heart = () => screen.getByRole("region").querySelector('svg[data-icon="heart"]')!;

  it.each([
    ["ok", "text-ok", true],
    ["degraded", "text-warn", true],
    ["outage", "text-bad", true],
    ["paused", "text-info", true],
    ["unavailable", "text-muted", true],
    ["pending", "text-muted", false],
  ] as const)("colours %s's heart and word with %s (heart filled: %s)", (health, colour, filled) => {
    render(<HealthCard overall={{ health, headline: "x" }} />);
    // Our own heart, hidden from screen readers: the status text carries the meaning.
    expect(heart()).toHaveAttribute("aria-hidden", "true");
    expect(heart()).toHaveClass(colour);
    expect(heart()).toHaveAttribute("data-filled", String(filled));
    expect(screen.getByRole("status").firstElementChild).toHaveClass(colour);
  });

  it("shows the tick as one line with a bar gauge, with the backend's own slow verdict", () => {
    const { rerender } = render(<HealthCard overall={{ health: "ok", headline: "x" }} tick={{ rate: 21.94, health: "healthy" }} />);
    const card = screen.getByRole("region", { name: "Health" });
    expect(card).toHaveTextContent("Tick 21.9/s · Healthy");
    // The bar is decoration: hidden, clamped to its 0-30 scale.
    expect(card.querySelector("svg[data-gauge]")).toHaveAttribute("aria-hidden", "true");
    rerender(<HealthCard overall={{ health: "degraded", headline: "x" }} tick={{ rate: 8.2, health: "slow" }} />);
    expect(screen.getByText("Slow")).toHaveClass("text-bad");
    expect(card).toHaveTextContent("Tick 8.2/s · Slow");
    rerender(<HealthCard overall={{ health: "ok", headline: "x" }} tick={{ rate: 60, health: "healthy" }} />);
    expect(card.querySelector("svg[data-gauge]")).toHaveAttribute("data-gauge", "30");
    expect(card).toHaveTextContent("Tick 60.0/s");
  });

  it("says no game is running instead of a bar, and shows no tick while the status loads", () => {
    const { rerender } = render(<HealthCard overall={{ health: "degraded", headline: "x" }} tick={null} />);
    expect(screen.getByText("Tick: no game running.")).toBeInTheDocument();
    expect(screen.getByRole("region").querySelector("svg[data-gauge]")).toBeNull();
    rerender(<HealthCard overall={{ health: "pending", headline: "x" }} />);
    expect(screen.queryByText(/Tick/)).not.toBeInTheDocument();
  });

  describe("the freshness badge", () => {
    const OBSERVED = "2026-09-22T22:25:00.000Z";
    const at = (seconds: number) => new Date(Date.parse(OBSERVED) + seconds * 1000);
    const badge = () => screen.getByRole("region").querySelector("[data-age]")!;
    const renderAt = (seconds: number, late = false) => {
      vi.useFakeTimers({ now: at(seconds) });
      render(<HealthCard overall={{ health: "ok", headline: "x" }} tick={{ rate: 20, health: "healthy" }} age={{ observedAt: OBSERVED, late }} />);
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
      renderAt(seconds);
      expect(badge().querySelector("[data-age-label]")).toHaveTextContent(label);
    });

    it("sits in the header with the heading, not in the tick line", () => {
      renderAt(8);
      const header = screen.getByRole("heading", { name: "Health" }).parentElement!;
      expect(header).toContainElement(badge() as HTMLElement);
      expect(screen.getByText("Tick").closest("div")).not.toContainElement(badge() as HTMLElement);
      expect(screen.getByText("Tick").closest("div")).not.toHaveTextContent(/live|ago/);
    });

    it("keeps the exact age as accessible text and a tooltip", () => {
      renderAt(8);
      expect(screen.getByText("Updated 8 s ago")).toHaveClass("sr-only");
      expect(badge()).toHaveAttribute("title", expect.stringContaining("Updated 8 s ago"));
    });

    it("turns amber and says so when the backend calls the data late", () => {
      renderAt(8, true);
      expect(badge()).toHaveClass("text-warn");
      expect(badge().querySelector("[data-age-label]")).toHaveTextContent("late");
      expect(badge()).toHaveTextContent("newer data is overdue");
    });

    it("is not shown without an age", () => {
      render(<HealthCard overall={{ health: "ok", headline: "x" }} />);
      expect(screen.getByRole("region").querySelector("[data-age]")).toBeNull();
    });
  });

  it("offers dismissal only when asked to, and reports the click", () => {
    const onDismiss = vi.fn();
    const { rerender } = render(<HealthCard overall={{ health: "degraded", headline: "Degraded" }} />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    rerender(<HealthCard overall={{ health: "degraded", headline: "Degraded" }} onDismiss={onDismiss} />);
    fireEvent.click(screen.getByRole("button", { name: "Hide this warning until something changes" }));
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it("stays in place when hidden: neutral, without the headline or the Hide button", () => {
    render(<HealthCard overall={{ health: "degraded", headline: "Running with warnings" }} hidden onDismiss={() => {}} />);
    expect(screen.getByRole("region", { name: "Health" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Warning hidden until something changes.");
    expect(screen.queryByText("Running with warnings")).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(heart()).toHaveClass("text-muted");
    expect(heart()).toHaveAttribute("data-filled", "false");
  });

  it("is a square beside Players from md up", () => {
    render(<HealthCard overall={{ health: "ok", headline: "x" }} />);
    expect(screen.getByRole("region")).toHaveClass("md:aspect-square");
    expect(screen.getByRole("region")).not.toHaveClass("md:col-span-2");
  });

  it("never shows the Hide button while hidden, even without onDismiss (hidden implies not dismissible-and-visible)", () => {
    // Defensive: canDismiss gates hidden and onDismiss together in OverviewView, but the card
    // itself doesn't assume that pairing. hidden=true with no onDismiss must still render
    // safely and never surface a button with no handler.
    render(<HealthCard overall={{ health: "outage", headline: "Power outage" }} hidden />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Warning hidden until something changes.");
  });
});

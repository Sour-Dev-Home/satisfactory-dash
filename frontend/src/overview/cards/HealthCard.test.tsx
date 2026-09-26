import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
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

  it("shows the server tick as a dial and as text, with the backend's own slow verdict", () => {
    const { rerender } = render(<HealthCard overall={{ health: "ok", headline: "x" }} tick={{ rate: 21.44, health: "healthy" }} />);
    const card = screen.getByRole("region", { name: "Health" });
    expect(card).toHaveTextContent("Server tick21.4 ticks/sHealthy");
    // The dial is decoration: hidden, with the needle clamped to its 0-30 scale.
    expect(card.querySelector("svg[data-gauge]")).toHaveAttribute("aria-hidden", "true");
    rerender(<HealthCard overall={{ health: "degraded", headline: "x" }} tick={{ rate: 8.2, health: "slow" }} />);
    expect(screen.getByText("Slow")).toHaveClass("text-bad");
    rerender(<HealthCard overall={{ health: "ok", headline: "x" }} tick={{ rate: 60, health: "healthy" }} />);
    expect(card.querySelector("svg[data-gauge]")).toHaveAttribute("data-gauge", "30");
    expect(card).toHaveTextContent("60.0 ticks/s");
  });

  it("says no game is running instead of a dial, and shows no tick while the status loads", () => {
    const { rerender } = render(<HealthCard overall={{ health: "degraded", headline: "x" }} tick={null} />);
    expect(screen.getByText("Server tick: no game running.")).toBeInTheDocument();
    expect(screen.getByRole("region").querySelector("svg[data-gauge]")).toBeNull();
    rerender(<HealthCard overall={{ health: "pending", headline: "x" }} />);
    expect(screen.queryByText(/Server tick/)).not.toBeInTheDocument();
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

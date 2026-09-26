import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { HealthCard } from "./HealthCard";

describe("HealthCard", () => {
  it("is a card with its own heading, announcing the state and headline as a status", () => {
    render(<HealthCard overall={{ health: "ok", headline: "All systems operational" }} />);
    expect(screen.getByRole("region", { name: "Health" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("OperationalAll systems operational");
  });

  it.each([
    ["ok", "bg-ok-solid", "text-ok", "ok"],
    ["degraded", "bg-warn-solid", "text-warn", "alert"],
    ["outage", "bg-bad-solid", "text-bad", "alert"],
    ["paused", "bg-info-solid", "text-info", "alert"],
    ["unavailable", "bg-idle-solid", "text-muted", "alert"],
    ["pending", "bg-surface-2", "text-muted", "pending"],
  ] as const)("colours %s with %s and %s and marks it with the %s icon", (health, badge, word, icon) => {
    render(<HealthCard overall={{ health, headline: "x" }} />);
    // Our own SVG mark, hidden from screen readers: the status text carries the meaning.
    const mark = screen.getByRole("region").querySelector('[aria-hidden="true"]')!;
    expect(mark).toHaveClass(badge);
    expect(mark.querySelector(`svg[data-icon="${icon}"]`)).not.toBeNull();
    expect(mark).toHaveTextContent("");
    expect(screen.getByRole("status").firstElementChild).toHaveClass(word);
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
    const mark = screen.getByRole("region").querySelector('[aria-hidden="true"]')!;
    expect(mark).not.toHaveClass("bg-warn-solid");
  });

  it("takes one grid column, beside Players", () => {
    render(<HealthCard overall={{ health: "ok", headline: "x" }} />);
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

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { HealthCard } from "./HealthCard";

describe("HealthCard", () => {
  it("announces the headline as a status", () => {
    render(<HealthCard overall={{ health: "ok", headline: "All systems operational" }} />);
    expect(screen.getByRole("status")).toHaveTextContent("All systems operational");
  });

  it.each([
    ["ok", "bg-ok-solid", "ok"],
    ["degraded", "bg-warn-solid", "alert"],
    ["outage", "bg-bad-solid", "alert"],
    ["paused", "bg-info-solid", "alert"],
    ["unavailable", "bg-idle-solid", "alert"],
    ["pending", "bg-surface-2", "pending"],
  ] as const)("colours %s with %s and marks it with the %s icon", (health, background, icon) => {
    const { container } = render(<HealthCard overall={{ health, headline: "x" }} />);
    const card = container.firstElementChild!;
    expect(card).toHaveClass(background);
    // Our own SVG mark, hidden from screen readers: the headline carries the meaning.
    const mark = card.querySelector('[aria-hidden="true"]')!;
    expect(mark.querySelector(`svg[data-icon="${icon}"]`)).not.toBeNull();
    expect(mark).toHaveTextContent("");
  });

  it("offers dismissal only when asked to, and reports the click", () => {
    const onDismiss = vi.fn();
    const { rerender } = render(<HealthCard overall={{ health: "degraded", headline: "Degraded" }} />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    rerender(<HealthCard overall={{ health: "degraded", headline: "Degraded" }} onDismiss={onDismiss} />);
    fireEvent.click(screen.getByRole("button", { name: "Hide this warning until something changes" }));
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it("spans the card grid's row", () => {
    const { container } = render(<HealthCard overall={{ health: "ok", headline: "x" }} />);
    expect(container.firstElementChild).toHaveClass("md:col-span-2");
  });
});

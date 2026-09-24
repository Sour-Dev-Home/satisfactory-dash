import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { HealthCard } from "./HealthCard";

describe("HealthCard", () => {
  it("announces the headline as a status", () => {
    render(<HealthCard overall={{ health: "ok", headline: "All systems operational" }} />);
    expect(screen.getByRole("status")).toHaveTextContent("All systems operational");
  });

  it.each([
    ["ok", "bg-ok-solid", "✓"],
    ["degraded", "bg-warn-solid", "!"],
    ["outage", "bg-bad-solid", "!"],
    ["paused", "bg-info-solid", "!"],
    ["unavailable", "bg-idle-solid", "!"],
    ["pending", "bg-surface-2", "…"],
  ] as const)("colours %s with %s and marks it %s", (health, background, mark) => {
    const { container } = render(<HealthCard overall={{ health, headline: "x" }} />);
    const card = container.firstElementChild!;
    expect(card).toHaveClass(background);
    // The mark is decoration; the headline carries the meaning.
    expect(card.querySelector('[aria-hidden="true"]')).toHaveTextContent(mark);
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

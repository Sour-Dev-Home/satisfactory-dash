import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { OverviewPanel } from "./OverviewPanel";

// Unit-level coverage for the Hide-button focus contract (OverviewView + dismissal.test.tsx
// cover the same contract end to end, through real storage; these pin it at the layer where
// the ref/effect actually lives, and probe a prop-timing case the integration test can't
// reach because dismissal.dismiss always updates its own state synchronously).

function baseProps(overrides: Partial<Parameters<typeof OverviewPanel>[0]> = {}) {
  return {
    overall: { health: "degraded" as const, headline: "Running with warnings" },
    sections: [],
    players: "pending" as const,
    ...overrides,
  };
}

const healthHeading = () => screen.getByRole("heading", { name: "Health" });

describe("OverviewPanel: Hide-button focus management", () => {
  it("moves focus to the Health heading once the click's own hidden transition lands", () => {
    const onDismiss = vi.fn();
    const { rerender } = render(<OverviewPanel {...baseProps({ onDismiss, bannerHidden: false })} />);
    fireEvent.click(screen.getByRole("button", { name: "Hide this warning until something changes" }));
    rerender(<OverviewPanel {...baseProps({ onDismiss, bannerHidden: true })} />);
    expect(document.activeElement).toBe(healthHeading());
  });

  it("does not autofocus the heading when it mounts already hidden (no click happened)", () => {
    const onDismiss = vi.fn();
    render(<OverviewPanel {...baseProps({ onDismiss, bannerHidden: true })} />);
    expect(document.activeElement).not.toBe(healthHeading());
  });

  it(
    // Found by the test-hunter on PR #168: the flag used to survive a click whose render didn't
    // hide the warning, then fire on a later, unrelated hide.
    "doesn't steal focus on a later hide when the click's own render didn't hide the warning",
    () => {
      const onDismiss = vi.fn();
      const { rerender } = render(<OverviewPanel {...baseProps({ onDismiss, bannerHidden: false })} />);
      fireEvent.click(screen.getByRole("button", { name: "Hide this warning until something changes" }));
      // The click's own transition never arrives (bannerHidden stays false, and dismissibility
      // itself drops away, e.g. because the warning became an outage in the same tick).
      rerender(<OverviewPanel {...baseProps({ onDismiss: undefined, bannerHidden: false })} />);
      expect(document.activeElement).not.toBe(healthHeading());
      // Later, for an unrelated reason, the card becomes hidden again.
      rerender(<OverviewPanel {...baseProps({ onDismiss, bannerHidden: true })} />);
      expect(document.activeElement).not.toBe(healthHeading());
    },
  );
});

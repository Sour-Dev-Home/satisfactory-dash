import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { historyPower24h } from "@satisfactory-dash/shared/fixtures";
import { StoredPowerHistoryPanel } from "./StoredPowerHistoryPanel";

// Fresh-eyes pass (PR #215): a circuit whose newest bucket has no points at all, e.g. the
// backend reports a circuit exists in the range but has nothing recorded for it yet.
describe("StoredPowerHistoryPanel, a circuit with no points", () => {
  const noPoints = { ...historyPower24h.data.series[0], points: [] };
  const history = { ...historyPower24h.data, series: [noPoints] };

  it("does not say there's one reading when there are zero", () => {
    render(<StoredPowerHistoryPanel history={history} />);
    expect(screen.queryByText("Only one reading in this range so far.")).not.toBeInTheDocument();
  });

  it("shows no fuse badge (there's no newest bucket to have tripped)", () => {
    render(<StoredPowerHistoryPanel history={history} />);
    expect(screen.queryByText("Fuse tripped")).not.toBeInTheDocument();
  });

  it("shows no summary stats", () => {
    render(<StoredPowerHistoryPanel history={history} />);
    expect(screen.queryByText("Production")).not.toBeInTheDocument();
  });
});

import { fireEvent, render, screen, within } from "@testing-library/react";
import type { FactoryResponse } from "@satisfactory-dash/shared";
import { factoryMixed } from "@satisfactory-dash/shared/fixtures";
import { describe, expect, it, vi } from "vitest";
import { FactoryPanel } from "./FactoryPanel";
import { factoryHealth } from "../overview/health";
import { MapPanel } from "../map/MapPanel";

// Issue 201 consistency hunt: a machine can now be state "backedUp" (inputs full, low percent) while
// isBackedUp (an output slot full) is false, so backedUpCount, the filter and the map ring miss it.
// Each `it.fails` documents an UNFIXED user-visible disagreement; remove `.fails` when fixed.

vi.mock("../map/MapCanvas", () => ({ default: () => <div data-testid="map-canvas" /> }));

const base = factoryMixed.data.buildings[0];
const input201 = { ...base, recipe: "Iron Plate", isBackedUp: false, isPaused: false, state: "backedUp" as const };
const normal = { ...base, isBackedUp: false, state: "producing" as const };

function snap(total: number, stateBacked: number): FactoryResponse {
  const buildings = Array.from({ length: total }, (_, i) => ({ ...(i < stateBacked ? input201 : normal), id: `b${i}`, recipe: `R${i}` }));
  return { ...factoryMixed, stale: false, data: { buildings, backedUpCount: buildings.filter((b) => b.isBackedUp).length, stateCounts: { backedUp: stateBacked, producing: total - stateBacked } } };
}

describe("state backedUp vs isBackedUp (issue 201)", () => {
  it.fails("FactoryPanel header counts a machine its own row labels Backed up", () => {
    render(<FactoryPanel snapshot={snap(2, 1)} />);
    expect(screen.getByText(/^2 machines · 1 backed up/)).toBeInTheDocument();
  });

  it.fails("the Backed up filter shows a machine whose state is backedUp", () => {
    render(<FactoryPanel snapshot={snap(2, 1)} />);
    fireEvent.click(within(screen.getByRole("group", { name: "Filter machines" })).getByRole("button", { name: "Backed up" }));
    expect(within(screen.getByRole("table")).getByRole("cell", { name: "R0" })).toBeInTheDocument();
  });

  it.fails("overview health counts state-backedUp machines toward the degraded share (3 of 4)", () => {
    expect(factoryHealth(snap(4, 3)).health).toBe("degraded");
  });

  it.fails("the map layer's text counts state-backedUp machines as backed up", async () => {
    render(<MapPanel snapshot={snap(2, 1)} />);
    await screen.findByTestId("map-canvas");
    expect(screen.getByText(/buildings on the map:/)).toHaveTextContent(/1 backed up\./);
  });
});

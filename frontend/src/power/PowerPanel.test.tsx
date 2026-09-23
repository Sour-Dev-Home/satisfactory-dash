import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { PowerResponse } from "@satisfactory-dash/shared";
import {
  powerAtRisk,
  powerCharging,
  powerDischarging,
  powerEmpty,
  powerOk,
  powerOutage,
  powerStale,
} from "@satisfactory-dash/shared/fixtures";
import { PowerPanel } from "./PowerPanel";

function circuit(id: number): HTMLElement {
  return screen.getByRole("article", { name: `Circuit ${id}` });
}

/** The <dd> after the <dt> with this label, inside one circuit card. */
function valueIn(card: HTMLElement, label: string): HTMLElement {
  return within(card).getByText(label, { selector: "dt" }).nextElementSibling as HTMLElement;
}

describe("PowerPanel", () => {
  it("shows a healthy circuit's readings in MW without alarms", () => {
    render(<PowerPanel snapshot={powerOk} />);
    const main = circuit(0);
    expect(within(main).getByText("OK")).toBeInTheDocument();
    expect(valueIn(main, "Production")).toHaveTextContent("3,633.3 MW");
    expect(valueIn(main, "Consumption")).toHaveTextContent("2,915.6 MW");
    expect(valueIn(main, "Capacity")).toHaveTextContent("4,083.3 MW");
    expect(valueIn(main, "Peak demand")).toHaveTextContent("4,606.5 MW");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByText(/As of/)).toHaveTextContent(new Date(powerOk.observedAt).toLocaleString());
  });

  it("warns that a grid could overload when peak demand is above capacity", () => {
    render(<PowerPanel snapshot={powerOk} />);
    expect(within(circuit(0)).getByText(/Could overload/)).toBeInTheDocument();
  });

  it("raises an outage alarm, lists the tripped circuit first and explains its 0 MW", () => {
    render(<PowerPanel snapshot={powerOutage} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Power outage: 1 circuit has a tripped fuse.");
    const cards = screen.getAllByRole("article");
    expect(cards[0]).toHaveAccessibleName("Circuit 1");
    const tripped = circuit(1);
    expect(within(tripped).getByText("Outage: fuse tripped")).toBeInTheDocument();
    expect(within(tripped).getByText("Reads 0 MW while the fuse is tripped.")).toBeInTheDocument();
    expect(valueIn(tripped, "Production")).toHaveTextContent("0 MW");
    // Capacity reads 0 while tripped, so no overload warning on that card.
    expect(within(tripped).queryByText(/Could overload/)).not.toBeInTheDocument();
  });

  it("shows at-risk circuits as a warning, not an alarm", () => {
    render(<PowerPanel snapshot={powerAtRisk} />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByText("1 circuit is at risk.")).toBeInTheDocument();
    expect(screen.getAllByRole("article")[0]).toHaveAccessibleName("Circuit 2");
    expect(within(circuit(2)).getByText("At risk")).toBeInTheDocument();
  });

  it("uses the backend's status even when the numbers alone look fine", () => {
    const flagged = {
      ...powerOk,
      data: { ...powerOk.data, circuits: [{ ...powerOk.data.circuits[0], status: "at_risk" as const }] },
    } satisfies PowerResponse;
    render(<PowerPanel snapshot={flagged} />);
    expect(within(circuit(0)).getByText("At risk")).toBeInTheDocument();
  });

  it("shows battery rows only when the circuit has batteries", () => {
    render(<PowerPanel snapshot={powerOk} />);
    expect(screen.queryByText("Battery storage")).not.toBeInTheDocument();
  });

  it("shows a charging battery", () => {
    render(<PowerPanel snapshot={powerCharging} />);
    const card = circuit(0);
    expect(valueIn(card, "Battery storage")).toHaveTextContent("100 MWh");
    expect(valueIn(card, "Battery charge")).toHaveTextContent("2.3%");
    expect(valueIn(card, "Battery flow")).toHaveTextContent("Charging 100 MW");
  });

  it("shows a discharging battery with a positive MW figure", () => {
    render(<PowerPanel snapshot={powerDischarging} />);
    expect(valueIn(circuit(0), "Battery flow")).toHaveTextContent("Discharging 80 MW");
    // Draining below 20 % is at_risk per the backend, though consumption is within capacity.
    expect(within(circuit(2)).getByText("At risk")).toBeInTheDocument();
    expect(valueIn(circuit(2), "Battery charge")).toHaveTextContent("12%");
  });

  it("says so when there are no circuits", () => {
    render(<PowerPanel snapshot={powerEmpty} />);
    expect(screen.getByText("No power circuits yet.")).toBeInTheDocument();
  });

  it("notes stale power data with its own observedAt", () => {
    render(<PowerPanel snapshot={powerStale} />);
    expect(
      screen.getByText(`Showing last known power data from ${new Date(powerStale.observedAt).toLocaleString()}.`),
    ).toBeInTheDocument();
  });
});

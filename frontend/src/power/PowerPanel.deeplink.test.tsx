import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { powerOk } from "@satisfactory-dash/shared/fixtures";
import { circuitLink } from "../lib/deepLinks";
import { PowerPanel } from "./PowerPanel";

const circuit = powerOk.data.circuits[0];

afterEach(() => window.history.replaceState(null, "", "/"));

// #351: /app/power#circuit-<id> opens the Power page on that circuit.
describe("PowerPanel deep link", () => {
  it("gives each circuit card its anchor", () => {
    render(<PowerPanel snapshot={powerOk} />);
    expect(screen.getByRole("article", { name: `Circuit ${circuit.circuitGroupId}` })).toHaveAttribute(
      "id",
      `circuit-${circuit.circuitGroupId}`,
    );
  });

  it("scrolls to and focuses the linked circuit", () => {
    Element.prototype.scrollIntoView = vi.fn();
    window.history.pushState({ key: "p1" }, "", circuitLink(circuit.circuitGroupId));
    render(<PowerPanel snapshot={powerOk} />);
    expect(screen.getByRole("article", { name: `Circuit ${circuit.circuitGroupId}` })).toHaveFocus();
  });
});

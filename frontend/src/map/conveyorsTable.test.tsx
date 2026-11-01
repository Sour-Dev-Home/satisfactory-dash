import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ConveyorEdge } from "@satisfactory-dash/shared";
import { placeConveyors, type BuildingPlace } from "./conveyors";
import { CONVEYOR_ROWS_MAX, ConveyorsTable } from "./WorldTables";

const edge = (over: Partial<ConveyorEdge> & Pick<ConveyorEdge, "id">): ConveyorEdge => ({
  kind: "belt",
  from: null,
  fromKind: null,
  to: null,
  toKind: null,
  capacityPerMinute: 60,
  tier: "Conveyor Belt Mk.1",
  at: { x: 0, y: 0 },
  ...over,
});
const buildings = new Map<string, BuildingPlace>([
  ["M1", { x: 0, y: 0, name: "Smelter" }],
  ["M2", { x: 0, y: 30, name: "Constructor" }],
]);

describe("ConveyorsTable", () => {
  it("lists kind, tier, length and both ends in words, never the bare id", () => {
    const list = placeConveyors(
      [
        edge({ id: "Build_ConveyorBeltMk1_C_1", from: "M1", fromKind: "machine", to: "M2", toKind: "machine" }),
        edge({ id: "Build_ConveyorLiftMk1_C_2", kind: "lift", tier: "Conveyor Lift Mk.1", from: "Build_ConveyorBeltMk1_C_1", fromKind: "conveyor", at: { x: 1, y: 1 } }),
        edge({ id: "Build_Pipeline_C_3", kind: "pipe", tier: "Pipeline Mk.1", capacityPerMinute: null, from: "J", fromKind: "junction", at: { x: 2, y: 2 } }),
      ],
      buildings,
    );
    render(<ConveyorsTable list={list} view={null} buildings={buildings} />);
    const table = screen.getByRole("table", { name: /Belts, lifts and pipes in view \(3\)/ });
    const rows = within(table).getAllByRole("row").slice(1);
    const cells = (row: HTMLElement) => within(row).getAllByRole("cell").map((c) => [c.getAttribute("data-label"), c.textContent]);
    expect(cells(rows[0])).toEqual([
      ["Kind", "Belt"],
      ["Tier", "Conveyor Belt Mk.1"],
      ["Length", "30 m"],
      ["From", "Smelter"],
      ["To", "Constructor"],
    ]);
    expect(cells(rows[1])).toEqual([
      ["Kind", "Lift"],
      ["Tier", "Conveyor Lift Mk.1"],
      ["Length", "Vertical"],
      ["From", "Belt"],
      ["To", "Open end"],
    ]);
    expect(cells(rows[2])).toEqual([
      ["Kind", "Pipe"],
      ["Tier", "Pipeline Mk.1"],
      ["Length", "Unknown"],
      ["From", "Pipe junction or pump"],
      ["To", "Open end"],
    ]);
  });

  it("renders at most CONVEYOR_ROWS_MAX rows for a huge layer, and says so", () => {
    const list = placeConveyors(Array.from({ length: 20_000 }, (_, i) => edge({ id: `C${i}`, at: { x: i % 100, y: 0 } })), new Map());
    render(<ConveyorsTable list={list} view={null} buildings={new Map()} />);
    expect(screen.getAllByRole("row")).toHaveLength(CONVEYOR_ROWS_MAX + 1);
    expect(screen.getByText(`Showing the first ${CONVEYOR_ROWS_MAX} of 20,000. Zoom in to list the rest.`)).toBeInTheDocument();
  });

  it("follows the view, and says when the layer is empty or nothing is in view", () => {
    const list = placeConveyors([edge({ id: "A", at: { x: 500, y: 500 } })], new Map());
    const { rerender } = render(<ConveyorsTable list={list} view={{ minX: 0, maxX: 10, minY: 0, maxY: 10 }} buildings={new Map()} />);
    expect(screen.getByRole("heading", { name: "Belts, lifts and pipes in view (0)" })).toBeInTheDocument();
    expect(screen.getByText("None in view. Zoom out or pan to see more.")).toBeInTheDocument();
    rerender(<ConveyorsTable list={[]} view={null} buildings={new Map()} />);
    expect(screen.getByText("None on the map.")).toBeInTheDocument();
  });

  it("keeps keys unique when ids repeat, and shows game text as text", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const hostile = "<img src=x onerror=alert(1)>";
    const list = placeConveyors([edge({ id: "A", tier: hostile }), edge({ id: "A" })], new Map());
    render(<ConveyorsTable list={list} view={null} buildings={new Map()} />);
    expect(screen.getByText(hostile)).toBeInTheDocument();
    expect(document.querySelector("img")).toBeNull();
    expect(spy.mock.calls.flat().join(" ")).not.toMatch(/same key/);
    spy.mockRestore();
  });
});

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { POWER_LINE_ROWS_MAX, PowerLinesTable } from "./WorldTables";

const many = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ id: "Build_PowerLine_C_1", points: [[i, 0], [i + 1, 0]] as [[number, number], [number, number]] }));

describe("PowerLinesTable", () => {
  it("renders at most POWER_LINE_ROWS_MAX rows for a huge layer, and says so", () => {
    render(<PowerLinesTable lines={many(20000)} view={null} />);
    expect(screen.getAllByRole("row")).toHaveLength(POWER_LINE_ROWS_MAX + 1);
    expect(screen.getByRole("heading", { name: "Power lines in view (20000)" })).toBeInTheDocument();
    expect(screen.getByText(/Showing the first 500 of 20,000/)).toBeInTheDocument();
  });

  it("lists repeated ids without a duplicate-key warning, and no note under the cap", () => {
    const errors: unknown[] = [];
    const orig = console.error;
    console.error = (...a: unknown[]) => errors.push(a);
    try {
      render(<PowerLinesTable lines={many(3)} view={null} />);
    } finally {
      console.error = orig;
    }
    expect(errors).toEqual([]);
    expect(screen.getAllByRole("row")).toHaveLength(4);
    expect(screen.queryByText(/Showing the first/)).not.toBeInTheDocument();
  });

  it("shows the cell text for an id that looks like markup as text", () => {
    render(<PowerLinesTable lines={[{ id: "<img src=x onerror=alert(1)>", points: [[0, 0], [3, 4]] }]} view={null} />);
    expect(screen.getByText("<img src=x onerror=alert(1)>")).toBeInTheDocument();
    expect(document.querySelector("img")).toBeNull();
  });
});

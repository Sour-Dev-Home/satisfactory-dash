import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StationsTable, TrainsTable } from "./WorldTables";
import { pointInView } from "./worldGeometry";

afterEach(() => vi.restoreAllMocks());

const view = { minX: 0, maxX: 100, minY: 0, maxY: 100 };

describe("pointInView", () => {
  it("is inclusive at the edges, exclusive outside, and true with no view", () => {
    expect(pointInView(view, { x: 0, y: 100 })).toBe(true);
    expect(pointInView(view, { x: 100, y: 0 })).toBe(true);
    expect(pointInView(view, { x: 101, y: 50 })).toBe(false);
    expect(pointInView(view, { x: 50, y: -1 })).toBe(false);
    expect(pointInView(null, { x: 1e9, y: -1e9 })).toBe(true);
  });
});

describe("TrainsTable and StationsTable", () => {
  it("lists only what is in view, with hostile names as text", () => {
    const hostile = "<img src=x onerror=alert(1)>";
    const { container } = render(
      <>
        <TrainsTable
          view={view}
          trains={[
            { id: "a", name: hostile, x: 10, y: 10, status: hostile },
            { id: "b", name: "Far", x: 5000, y: 5000, status: "Manual" },
          ]}
        />
        <StationsTable view={view} stations={[{ id: "s", name: "Near", x: 1, y: 1 }]} />
      </>,
    );
    expect(container.querySelector("img")).toBeNull();
    expect(screen.queryByText("Far")).toBeNull();
    expect(screen.getAllByText(hostile)).toHaveLength(2);
    expect(screen.getByText("Near")).toBeTruthy();
  });

  it("does not trigger React duplicate-key warnings when two trains or stations share an id", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <>
        <TrainsTable
          view={null}
          trains={[
            { id: "same", name: "One", x: 1, y: 1, status: "Self-Driving" },
            { id: "same", name: "Two", x: 2, y: 2, status: "Self-Driving" },
          ]}
        />
        <StationsTable
          view={null}
          stations={[
            { id: "same", name: "S1", x: 1, y: 1 },
            { id: "same", name: "S2", x: 2, y: 2 },
          ]}
        />
      </>,
    );
    const keyWarnings = error.mock.calls.filter((c) => String(c[0]).includes("same key"));
    expect(keyWarnings).toHaveLength(0);
  });
});

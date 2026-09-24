import { fireEvent, render, screen, within } from "@testing-library/react";
import { factoryMixed, factoryOldBackend } from "@satisfactory-dash/shared/fixtures";
import { describe, expect, it, vi } from "vitest";
import type { DrawnLayer, ViewM } from "./MapCanvas";
import { MapPanel } from "./MapPanel";

// jsdom has no canvas, so Leaflet can't draw here: a stub stands in for the lazy map chunk,
// records what it was given, and reports the view the test sets. The real map runs in e2e.
const canvas = vi.hoisted(() => ({ layers: [] as DrawnLayer[], fitTo: undefined as ViewM | undefined, view: null as ViewM | null }));
vi.mock("./MapCanvas", () => ({
  default: ({ layers, fitTo, onView }: { layers: DrawnLayer[]; fitTo?: ViewM; onView: (v: ViewM) => void }) => {
    canvas.layers = layers;
    canvas.fitTo = fitTo;
    if (canvas.view) queueMicrotask(() => onView(canvas.view!));
    return <div data-testid="map-canvas" />;
  },
}));

const buildings = factoryMixed.data.buildings;

describe("MapPanel", () => {
  it("draws the buildings layer and fits the first view to the factory", async () => {
    canvas.view = null;
    render(<MapPanel snapshot={factoryMixed} />);
    await screen.findByTestId("map-canvas");
    expect(canvas.layers.map((l) => l.layer.id)).toEqual(["buildings"]);
    const xs = buildings.map((b) => b.location!.xM);
    expect(canvas.fitTo).toMatchObject({ minX: Math.min(...xs), maxX: Math.max(...xs) });
  });

  it("describes the layer in text: counts by state and backed up", async () => {
    render(<MapPanel snapshot={factoryMixed} />);
    await screen.findByTestId("map-canvas");
    expect(screen.getByText(/^5 buildings on the map:/)).toHaveTextContent(/2 backed up\./);
  });

  it("lists only the buildings in view, and follows the view", async () => {
    const first = buildings[0].location!;
    canvas.view = { minX: first.xM - 1, maxX: first.xM + 1, minY: first.yM - 1, maxY: first.yM + 1 };
    render(<MapPanel snapshot={factoryMixed} />);
    const table = await screen.findByRole("table", { name: /Buildings in view \(\d+\)/ });
    const rows = within(table).getAllByRole("row").slice(1);
    const expected = buildings.filter((b) => b.location!.xM === first.xM && b.location!.yM === first.yM);
    expect(rows).toHaveLength(expected.length);
    expect(rows[0]).toHaveTextContent(buildings[0].name);
    canvas.view = null;
  });

  it("says so when nothing is in view", async () => {
    canvas.view = { minX: 9000, maxX: 9001, minY: 9000, maxY: 9001 };
    render(<MapPanel snapshot={factoryMixed} />);
    expect(await screen.findByText("None in view. Zoom out or pan to see more.")).toBeInTheDocument();
    canvas.view = null;
  });

  it("hides the layer, its legend and its list when toggled off", async () => {
    render(<MapPanel snapshot={factoryMixed} />);
    await screen.findByTestId("map-canvas");
    fireEvent.click(screen.getByRole("checkbox", { name: "Buildings" }));
    expect(canvas.layers).toEqual([]);
    expect(screen.queryByText("Backed up (ring)")).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /Buildings in view/ })).not.toBeInTheDocument();
  });

  it("works with an older backend that sends no positions: says so, and shows the whole world", async () => {
    render(<MapPanel snapshot={factoryOldBackend} />);
    await screen.findByTestId("map-canvas");
    expect(canvas.fitTo).toBeUndefined();
    expect(screen.getByText(/^0 buildings on the map/)).toHaveTextContent(/have no position yet/);
  });
});

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import type { PlannerNode, PlannerRate, ProductionGraph } from "@satisfactory-dash/shared";
import { renderOutline, outlineRowOf, outlineRows } from "../test/outline";
import { treeNode, treeWorld } from "../test/plannerTree";
import { buildFactoryTree, levelOf } from "./factoryTree";
import { OUTLINE_OPEN_MAX, type OutlineConnection } from "./outlineModel";
import { PlannerOutline } from "./PlannerOutline";

afterEach(() => act(() => new Promise<void>((resolve) => setTimeout(resolve, 0))));

const rate = (name: string, current: number, max: number): PlannerRate => ({ className: `Desc_${name}_C`, name, unit: "items/min", currentPerMinute: current, maxPerMinute: max });
const group = (key: string, over: Partial<PlannerNode> = {}): PlannerNode => ({
  key,
  kind: "machines",
  className: "Build_SmelterMk1_C",
  name: `Smelter ${key}`,
  recipe: "Iron Ingot",
  count: 1,
  machineIds: [`m-${key}`],
  stateCounts: { producing: 1 },
  products: [rate("Iron Ingot", 30, 30)],
  ingredients: [],
  at: { x: 0, y: 0 },
  siteKey: "s",
  loop: false,
  ...over,
});

const conn = (key: string, rateSort: number | null): OutlineConnection => ({
  key,
  fromKey: key,
  toKey: "z",
  from: key,
  to: "Z",
  item: "Iron Ore",
  itemNote: null,
  rate: String(rateSort),
  rateSort,
  carrier: "Belt",
  capacity: "cap",
  flow: `flow-${key}`,
});

/** The overview's outline over the tree world, with `extra` more groups in the "Screws" factory. */
function treeOutline(extra: number, current: string | null = null) {
  const world = treeWorld();
  const many = Array.from({ length: extra }, (_, i) => ({ ...treeNode(`big${i}`, "Desc_IronScrew_C", 5, 10), name: `Big ${i}` }));
  const screws = world.graph.factories!.find((f) => f.name === "Screws")!;
  const graph: ProductionGraph = {
    ...world.graph,
    nodes: [...world.graph.nodes, ...many],
    factories: world.graph.factories!.map((f) => (f === screws ? { ...f, nodeKeys: [...f.nodeKeys, ...many.map((n) => n.key)] } : f)),
  };
  const tree = buildFactoryTree(graph, world.designations, false);
  const { entries } = levelOf(tree, []);
  return (
    <MemoryRouter>
      <PlannerOutline
        graph={graph}
        nodes={entries.flatMap((e) => e.card.nodes)}
        findings={[]}
        factories={{ entries, tree, label: "Factories" }}
        level={4}
        labelOf={(k) => graph.nodes.find((n) => n.key === k)?.name ?? "?"}
        connections={[]}
        noConnections="none"
        noGroups="none"
        current={current}
        onShowInGraph={() => {}}
      />
    </MemoryRouter>
  );
}

describe("outline state across polls (hunt)", () => {
  it("keeps the viewer's closed factory closed when a poll moves it across the open limit", () => {
    // Screws has 1 group of its own: 1 + 19 = 20 is open by default (the limit is inclusive), 21 is closed by default.
    const { rerender } = render(treeOutline(OUTLINE_OPEN_MAX - 1));
    const toggle = screen.getByRole("button", { name: "Screws" });
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    rerender(treeOutline(OUTLINE_OPEN_MAX));
    expect(screen.getByRole("button", { name: "Screws" })).toHaveAttribute("aria-expanded", "false");
  });

  it("keeps the viewer's opened factory open when a poll moves it the other way", () => {
    const { rerender } = render(treeOutline(OUTLINE_OPEN_MAX));
    const toggle = screen.getByRole("button", { name: "Screws" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(toggle);
    rerender(treeOutline(OUTLINE_OPEN_MAX - 1));
    expect(screen.getByRole("button", { name: "Screws" })).toHaveAttribute("aria-expanded", "true");
  });

  it("opens the closed factory that hides the current row and focuses the row on mount", async () => {
    render(treeOutline(OUTLINE_OPEN_MAX, "big3"));
    expect(screen.getByRole("button", { name: "Screws" })).toHaveAttribute("aria-expanded", "true");
    const row = outlineRowOf("Big 3")!;
    expect(row).toHaveAttribute("aria-current", "true");
    await waitFor(() => expect(row).toHaveFocus());
  });

  it("focuses a factory's own row when it is the current selection", async () => {
    const world = treeWorld();
    const key = world.graph.factories!.find((f) => f.name === "Screws")!.key;
    render(treeOutline(0, key));
    const li = screen.getByRole("button", { name: "Screws" }).closest("li")!;
    expect(li).toHaveAttribute("aria-current", "true");
    await waitFor(() => expect(li).toHaveFocus());
  });

  it("does not steal the keyboard on a poll once the row was focused", async () => {
    const { rerender } = render(treeOutline(2, "big1"));
    await waitFor(() => expect(outlineRowOf("Big 1")).toHaveFocus());
    const other = screen.getAllByRole("button", { name: /Show in graph/ })[0]!;
    act(() => other.focus());
    rerender(treeOutline(2, "big1"));
    expect(other).toHaveFocus();
  });
});

describe("outline selection keys (hunt)", () => {
  it("lets go of a current key that has no row, without moving the keyboard or throwing", () => {
    renderOutline([group("a"), group("b")], { current: "card-of-another-level" });
    expect(outlineRows().some((r) => r.hasAttribute("aria-current"))).toBe(false);
    expect(document.body).toHaveFocus();
  });

  it("does not focus a late-arriving row for a key it once let go", () => {
    const first = [group("a")];
    const props = (nodes: PlannerNode[]) => (
      <MemoryRouter>
        <PlannerOutline
          graph={{ ...(treeWorld().graph), nodes, edges: [], transports: [] }}
          nodes={nodes}
          findings={[]}
          level={5}
          labelOf={(k) => k}
          connections={[]}
          noConnections="none"
          noGroups="none"
          current="late"
          onShowInGraph={() => {}}
        />
      </MemoryRouter>
    );
    const { rerender } = render(props(first));
    expect(document.body).toHaveFocus();
    rerender(props([...first, group("late")]));
    expect(outlineRowOf("Smelter late")).toHaveAttribute("aria-current", "true");
    expect(document.body).toHaveFocus();
  });

  it("marks exactly one row current and reports Show in graph with the row's own key", () => {
    const keys: string[] = [];
    renderOutline([group("a"), group("b")], { current: "b", onShowInGraph: (k) => keys.push(k) });
    expect(outlineRows().map((r) => r.hasAttribute("aria-current"))).toEqual([false, true]);
    fireEvent.click(within(outlineRows()[0]!).getByRole("button", { name: /^Show in graph/ }));
    expect(keys).toEqual(["a"]);
  });
});

describe("All connections (hunt)", () => {
  it("keeps a row's detail with that row when the table is re-sorted", () => {
    renderOutline([group("a")], { connections: [conn("Mid", 60), conn("Slow", 10), conn("Fast", 480)] });
    fireEvent.click(screen.getByRole("button", { name: "All connections" }));
    fireEvent.click(screen.getByRole("button", { name: "Details: Slow to Z, Iron Ore" }));
    expect(screen.getByText(/Flow: flow-Slow/)).toBeInTheDocument();
    fireEvent.click(within(screen.getByRole("columnheader", { name: /Rate/ })).getByRole("button"));
    const rows = within(screen.getByRole("table")).getAllByRole("row");
    const at = rows.findIndex((r) => /Flow: flow-Slow/.test(r.textContent ?? ""));
    expect(rows[at - 1]).toHaveTextContent("Slow");
    expect(screen.getAllByText(/Flow: flow-/)).toHaveLength(1);
  });

  it("closing the disclosure and opening it again keeps a table that is still well formed", () => {
    renderOutline([group("a")], { connections: [conn("Mid", 60)] });
    const disclosure = screen.getByRole("button", { name: "All connections" });
    fireEvent.click(disclosure);
    fireEvent.click(disclosure);
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.getByText("1 connection")).toBeInTheDocument();
    fireEvent.click(disclosure);
    expect(within(screen.getByRole("table")).getAllByRole("rowheader")).toHaveLength(1);
  });

  it("says nothing is known, not an empty table, for no rows", () => {
    renderOutline([group("a")]);
    fireEvent.click(screen.getByRole("button", { name: "All connections" }));
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.getByText("No connections.")).toBeInTheDocument();
  });
});
